from __future__ import annotations

import hashlib
import json
import urllib.request

import typer

from jbc.config import DATA, RESULTS, ROOT, load_yaml
from jbc.schemas import Item, Pair, ParentPR, Pref, Rating, dump_json, read_jsonl, write_jsonl

VERIFIED_URL = ("https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified/resolve/main/"
                "data/test-00000-of-00001.parquet")

app = typer.Typer(add_completion=False, help="JudgeBench-Code: evaluate code autoraters.")


def _items() -> list[Item]:
    return read_jsonl(DATA / "items.jsonl", Item)


def _pairs() -> list[Pair]:
    return read_jsonl(DATA / "pairs.jsonl", Pair)


@app.command()
def fetch(config: str = "configs/sources.yaml", repo: list[str] | None = typer.Option(None)):
    """Fetch clean merged parent PRs from GitHub -> data/parents.jsonl."""
    from jbc.github import GH, fetch_repo

    cfg = load_yaml(ROOT / config)
    gh = GH()
    existing = {p.id: p for p in read_jsonl(DATA / "parents.jsonl", ParentPR)}
    for r in cfg["repos"]:
        if repo and r["repo"] not in repo:
            continue
        if sum(p.repo == r["repo"] for p in existing.values()) >= cfg["per_repo"]:
            continue
        typer.echo(f"{r['repo']} ({r['language']})")
        try:
            for p in fetch_repo(gh, r["repo"], r["language"], cfg, log=typer.echo):
                existing[p.id] = p
        except Exception as e:  # noqa: BLE001
            typer.echo(f"  ! {type(e).__name__}: {e}")
        write_jsonl(DATA / "parents.jsonl", existing.values())
    parents = list(existing.values())[: cfg["target_parents"]]
    write_jsonl(DATA / "parents.jsonl", parents)
    typer.echo(f"{len(parents)} parents -> data/parents.jsonl")


@app.command("fetch-context")
def fetch_context():
    """Fetch base-revision contents of changed source files (used by pad_context)."""
    from jbc.github import GH
    from jbc.perturb.diffutil import is_test_path, parse_diff

    gh = GH()
    parents = read_jsonl(DATA / "parents.jsonl", ParentPR)
    for p in parents:
        for f in parse_diff(p.diff):
            if p.base_sha and f.path not in p.base_files and not is_test_path(f.path) \
                    and f.hunks and f.hunks[0].old_start > 0:
                txt = gh.file(p.repo, f.path, p.base_sha)
                if txt is not None:
                    p.base_files[f.path] = txt
        typer.echo(f"{p.id}: {len(p.base_files)} base files")
    write_jsonl(DATA / "parents.jsonl", parents)


@app.command("agent-fetch")
def agent_fetch(since: str = "2026-06-01", per_bucket: int = 15, min_stars: int = 100,
                max_per_repo: int = 4):
    """Collect agent-authored PRs (merged vs closed) -> data/agent_items.jsonl + agent_outcomes.json."""
    from jbc.agent_prs import collect
    from jbc.github import GH

    items, outcome = collect(GH(), since, per_bucket, min_stars, log=typer.echo,
                             max_per_repo=max_per_repo)
    write_jsonl(DATA / "agent_items.jsonl", items)
    dump_json(DATA / "agent_outcomes.json", outcome)
    typer.echo(f"{len(items)} agent PRs ({sum(outcome.values())} merged)")


@app.command("swe-fetch")
def swe_fetch(experiments: str = "../swe-experiments/evaluation/verified",
              tasks: str = "data/swe/verified.parquet", seed: int = 0):
    """Real agent patches on SWE-bench Verified with hidden-test labels -> data/swe/."""
    import pyarrow.parquet as pq

    tp = ROOT / tasks
    if not tp.exists():
        tp.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(VERIFIED_URL, tp)

    from jbc.swe import collect, split_of

    rows = pq.read_table(tp).to_pylist()
    items, outcome = collect((ROOT / experiments).resolve(), rows, seed=seed, log=typer.echo)
    write_jsonl(DATA / "swe" / "items.jsonl", items)
    dump_json(DATA / "swe" / "outcomes.json", outcome)
    dump_json(DATA / "swe" / "split.json", {p: split_of(p) for p in sorted({i.parent_id for i in items})})
    typer.echo(f"{len({i.parent_id for i in items})} tasks, {len(items)} patches "
               f"({sum(outcome.values())} resolved)")


def _rate_set(items: list[Item], fname: str, judges: str, only: list[str] | None, workers: int,
              samples: tuple[int, ...] = (0,)):
    from concurrent.futures import ThreadPoolExecutor

    from jbc.judges import build_judges

    for j in build_judges(load_yaml(ROOT / judges), only):
        path = RESULTS / j.id / fname
        path.parent.mkdir(parents=True, exist_ok=True)
        done = {(r.item_id, r.meta.get("sample", 0)): r for r in read_jsonl(path, Rating)}
        todo = [(it, s) for s in samples for it in items if (it.id, s) not in done]

        def one(job, j=j):
            it, s = job
            try:
                r = j.rate(it, sample=s)
            except Exception as e:  # noqa: BLE001
                typer.echo(f"  ! {j.id} {it.id}: {type(e).__name__}: {str(e)[:120]}")
                return None
            r.meta = {**r.meta, "sample": s}
            return r

        with ThreadPoolExecutor(workers) as ex:
            for r in ex.map(one, todo):
                if r:
                    done[(r.item_id, r.meta["sample"])] = r
        write_jsonl(path, done.values())
        typer.echo(f"{j.id}: {len(done)} ratings in {fname}")


@app.command("agent-run")
def agent_run(judges: str = "configs/judges.yaml", only: list[str] | None = typer.Option(None),
              workers: int = 8):
    """Rate agent-authored PRs with each judge -> results/<judge>/agent_ratings.jsonl."""
    _rate_set(read_jsonl(DATA / "agent_items.jsonl", Item), "agent_ratings.jsonl", judges, only, workers)


@app.command("swe-run")
def swe_run(judges: str = "configs/judges.yaml", only: list[str] | None = typer.Option(None),
            workers: int = 8, split: str = "all"):
    """Rate SWE-bench agent patches -> results/<judge>/swe_ratings.jsonl."""
    sp = json.loads((DATA / "swe" / "split.json").read_text())
    items = [i for i in read_jsonl(DATA / "swe" / "items.jsonl", Item) if split == "all" or sp[i.parent_id] == split]
    _rate_set(items, "swe_ratings.jsonl", judges, only, workers)


@app.command()
def retest(judges: str = "configs/judges.yaml", only: list[str] | None = typer.Option(None),
           k: int = 3, workers: int = 8):
    """Re-grade each unchanged original k-1 more times -> results/<judge>/retest.jsonl (noise floor)."""
    items = [i for i in _items() if i.perturbation == "none"]
    _rate_set(items, "retest.jsonl", judges, only, workers, samples=tuple(range(1, k)))


@app.command()
def perturb(seed: int = 0):
    """Generate perturbed items and pairs from parents."""
    from jbc.perturb import make_items, make_pairs

    parents = read_jsonl(DATA / "parents.jsonl", ParentPR)
    items = make_items(parents, seed=seed)
    pairs = make_pairs(items)
    write_jsonl(DATA / "items.jsonl", items)
    write_jsonl(DATA / "pairs.jsonl", pairs)
    counts: dict[str, int] = {}
    for i in items:
        counts[i.perturbation] = counts.get(i.perturbation, 0) + 1
    sha = hashlib.sha256((DATA / "items.jsonl").read_bytes()).hexdigest()[:12]
    typer.echo(f"{len(parents)} parents -> {len(items)} items, {len(pairs)} pairs (dataset {sha})")
    typer.echo(json.dumps(counts))


@app.command()
def estimate(judges: str = "configs/judges.yaml"):
    """Estimate tokens and cost for running all configured judges."""
    from jbc.judges import build_judges

    items, pairs = _items(), _pairs()
    by_id = {i.id: i for i in items}
    total = 0.0
    for j in build_judges(load_yaml(ROOT / judges)):
        tin = tout = 0
        for it in items:
            a, b = j.estimate_tokens(it)
            tin, tout = tin + a, tout + b
        for p in pairs:
            a1, _ = j.estimate_tokens(by_id[p.a])
            a2, _ = j.estimate_tokens(by_id[p.b])
            tin += 2 * (a1 + a2)
            tout += 2 * 200 if a1 else 0
        # Prefer observed token usage (includes reasoning/thinking tokens) from earlier runs.
        tag = ""
        seen_r = [r.meta for r in read_jsonl(RESULTS / j.id / "ratings.jsonl", Rating) if "in_tok" in r.meta]
        seen_p = [r.meta for r in read_jsonl(RESULTS / j.id / "prefs.jsonl", Pref) if "in_tok" in r.meta]
        if len(seen_r) >= 5:
            mean_in = sum(x["in_tok"] for x in seen_r) / len(seen_r)
            mean_out = sum(x["out_tok"] for x in seen_r) / len(seen_r)
            pin = sum(x["in_tok"] for x in seen_p) / len(seen_p) if len(seen_p) >= 5 else 2 * mean_in
            pout = sum(x["out_tok"] for x in seen_p) / len(seen_p) if len(seen_p) >= 5 else 200
            tin = mean_in * len(items) + pin * 2 * len(pairs)
            tout = mean_out * len(items) + pout * 2 * len(pairs)
            tag = f"  (calibrated from {len(seen_r)} runs)"
        cost = (tin * getattr(j, "price_in", 0) + tout * getattr(j, "price_out", 0)) / 1e6
        total += cost
        typer.echo(f"{j.id:22s} in={tin/1e6:6.2f}M out={tout/1e6:5.2f}M  ~${cost:7.2f}{tag}")
    typer.echo(f"{'TOTAL':22s} ~${total:.2f}")


@app.command()
def run(judges: str = "configs/judges.yaml", only: list[str] | None = typer.Option(None),
        limit: int = 0, workers: int = 8, rate: bool = True, compare: bool = True):
    """Run judges over items (rate) and pairs (compare). Resumable."""
    from jbc.harness import run_judge
    from jbc.judges import build_judges

    items, pairs = _items(), _pairs()
    if limit:
        keep = sorted({i.parent_id for i in items})[:limit]
        items = [i for i in items if i.parent_id in keep]
        ids = {i.id for i in items}
        pairs = [p for p in pairs if p.a in ids and p.b in ids]
    for j in build_judges(load_yaml(ROOT / judges), only):
        typer.echo(f"== {j.id}: {len(items)} items, {len(pairs)} pairs")
        stats = run_judge(j, items, pairs, workers=workers, do_rate=rate, do_compare=compare,
                          log=typer.echo)
        typer.echo(f"   {stats}")


@app.command()
def score():
    """Compute scorecard.json and failures.json from results/."""
    from jbc.metrics import (
        AXES,
        failures,
        judge_scorecard,
        merge_auroc,
        rank_robustness,
        swe_metrics,
    )

    op = DATA / "agent_outcomes.json"
    outcomes = json.loads(op.read_text()) if op.exists() else {}

    from jbc.stats import deltas, perturbation_effects

    swe_dir = DATA / "swe"
    swe_out = json.loads((swe_dir / "outcomes.json").read_text()) if (swe_dir / "outcomes.json").exists() else {}
    swe_split = json.loads((swe_dir / "split.json").read_text()) if (swe_dir / "split.json").exists() else {}

    items, pairs = _items(), _pairs()
    board, fails = {}, []
    for d in sorted(p for p in RESULTS.iterdir() if p.is_dir()):
        ratings = read_jsonl(d / "ratings.jsonl", Rating)
        prefs = read_jsonl(d / "prefs.jsonl", Pref)
        if not ratings and not prefs:
            continue
        board[d.name] = judge_scorecard(items, pairs, ratings, prefs, read_jsonl(d / "retest.jsonl", Rating))
        board[d.name]["mixed_effects"] = perturbation_effects(deltas(items, ratings))
        swe = read_jsonl(d / "swe_ratings.jsonl", Rating)
        if swe and swe_out:
            board[d.name]["metrics"].update(swe_metrics(swe, swe_out, swe_split, "test"))
            board[d.name]["swe_dev"] = swe_metrics(swe, swe_out, swe_split, "dev")
        agent = read_jsonl(d / "agent_ratings.jsonl", Rating)
        if agent and outcomes:
            board[d.name]["metrics"]["merge_auroc"] = merge_auroc(agent, outcomes)
        fails += failures(items, ratings, d.name)
    out = {"axes": {k: {"direction": v[0], "desc": v[1]} for k, v in AXES.items()},
           "judges": board, "rank_robustness": rank_robustness(board), "n_items": len(items), "n_pairs": len(pairs),
           "n_parents": len({i.parent_id for i in items})}
    dump_json(RESULTS / "scorecard.json", out)
    dump_json(RESULTS / "failures.json", fails)

    def fmt(m: dict, k: str) -> str:
        return f"{m[k]['value']:.2f}" if m.get(k) else "  - "

    for jid, s in sorted(board.items(), key=lambda kv: -(kv[1]["composite"] or 0)):
        m = s["metrics"]
        typer.echo(f"{jid:22s} comp={'  - ' if s['composite'] is None else format(s['composite'], '.2f')} hack={fmt(m, 'hack_catch_rate')} "
                   f"scope={fmt(m, 'scope_sensitivity')} pad={fmt(m, 'length_bias')} "
                   f"desc={fmt(m, 'desc_gaming')} stab={fmt(m, 'stability')} "
                   f"pair={fmt(m, 'pairwise_acc')} flip={fmt(m, 'position_flip_rate')} "
                   f"${s['cost_usd_total']:.2f}")


@app.command()
def export(out: str = "site/public/data", showcase: int = 10):
    """Bundle scorecard, failures and playground data for the static site."""
    from jbc.export import export_site

    export_site(ROOT / out, showcase=showcase)
    typer.echo(f"exported -> {out}")


if __name__ == "__main__":
    app()
