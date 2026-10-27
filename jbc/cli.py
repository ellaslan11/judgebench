from __future__ import annotations

import hashlib
import json
import urllib.request
from collections import defaultdict
from pathlib import Path

import typer

from jbc.config import DATA, RESULTS, ROOT, load_yaml
from jbc.schemas import (
    Item,
    Pair,
    ParentPR,
    Pref,
    Rating,
    append_jsonl,
    dump_json,
    read_jsonl,
    write_jsonl,
)

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


@app.command("swe-pool")
def swe_pool(experiments: str = "../swe-experiments/evaluation/verified",
             tasks: str = "data/swe/verified.parquet", which: str = "test"):
    """All distinct submission patches per task of one split -> data/swe/pool_*.json(l)."""
    import pandas as pd

    from jbc.swe import collect_pool

    sp = json.loads((DATA / "swe" / "split.json").read_text())
    rows = pd.read_parquet(ROOT / tasks).to_dict("records")
    items, outcome = collect_pool(ROOT / experiments, rows, sp, read_jsonl(DATA / "swe" / "items.jsonl", Item), which)
    write_jsonl(DATA / "swe" / "pool_items.jsonl", items)
    dump_json(DATA / "swe" / "pool_outcomes.json", outcome)
    typer.echo(f"{len({i.parent_id for i in items})} tasks, {len(items)} patches ({sum(outcome.values())} resolved)")


@app.command("swe-pool-run")
def swe_pool_run(judges: str = "configs/judges.yaml", only: list[str] | None = typer.Option(None),
                 workers: int = 8):
    """Rate pool patches not already in swe_ratings.jsonl -> results/<judge>/swe_pool_ratings.jsonl."""
    from jbc.judges import build_judges

    pool = read_jsonl(DATA / "swe" / "pool_items.jsonl", Item)
    for j in build_judges(load_yaml(ROOT / judges), only):
        have = {r.item_id for r in read_jsonl(RESULTS / j.id / "swe_ratings.jsonl", Rating)}
        _rate_set([i for i in pool if i.id not in have], "swe_pool_ratings.jsonl", judges, [j.id], workers)


@app.command()
def attack(judges: str = "configs/judges.yaml", only: list[str] | None = typer.Option(None),
           attacker: str = "gpt-6.1-sol", rounds: int = 3, workers: int = 8, limit: int = 0,
           side: str = "fail", targets_from: str = ""):
    """Adaptive attack on one patch per test task: the judge's top-scored failing one, or with
    --side pass the top-scored passing one (the control: same treatment for the patches it competes with).
    --targets-from J reuses judge J's targets (same patches, so judges can be compared directly)."""
    from jbc.attack import run_attacks
    from jbc.judges import build_judges

    sp = json.loads((DATA / "swe" / "split.json").read_text())
    out = json.loads((DATA / "swe" / "outcomes.json").read_text())
    swe = {i.id: i for i in read_jsonl(DATA / "swe" / "items.jsonl", Item)}
    for j in build_judges(load_yaml(ROOT / judges), only):
        rs = {r.item_id: r for r in read_jsonl(RESULTS / j.id / "swe_ratings.jsonl", Rating)}
        best: dict[str, Rating] = {}
        tag = "" if side == "fail" else "_pass"
        if targets_from:
            src = read_jsonl(RESULTS / targets_from / f"attack{tag}.jsonl", Rating)
            for iid in sorted({r.meta["target"] for r in src}):
                if iid in rs:
                    best[iid.split("::")[0]] = rs[iid]
        for iid, r in sorted(rs.items()):
            t = iid.split("::")[0]
            if targets_from:
                break
            if iid in swe and out[iid] == (side == "pass") and sp.get(t) == "test" and (t not in best or r.overall > best[t].overall):
                best[t] = r
        path = RESULTS / j.id / f"attack{tag}.jsonl"
        done = {r.meta.get("target") for r in read_jsonl(path, Rating)}
        targets = [(swe[r.item_id], r) for t, r in sorted(best.items()) if r.item_id not in done]
        targets = targets[:limit] if limit else targets
        res = run_attacks(j, targets, attacker, rounds, workers, log=typer.echo)
        for it, r in res:
            append_jsonl(path, r)
            append_jsonl(RESULTS / j.id / f"attack{tag}_items.jsonl", it)
        typer.echo(f"{j.id}: {len({r.meta['target'] for _, r in res})} targets, {len(res)} attacked ratings")


@app.command("attack-replay")
def attack_replay(judge: str = "rubric-gpt6.1-sol", task: str = "", pick: str = "best"):
    """Replay one cached attack for a demo: original failing patch and score, then each round's
    rewritten description, added test file and new score. No API calls."""
    swe = {i.id: i for i in read_jsonl(DATA / "swe" / "items.jsonl", Item)}
    base = {r.item_id: r for r in read_jsonl(RESULTS / judge / "swe_ratings.jsonl", Rating)}
    att = read_jsonl(RESULTS / judge / "attack.jsonl", Rating)
    items = {i.id: i for i in read_jsonl(RESULTS / judge / "attack_items.jsonl", Item)}
    by_target: dict[str, list[Rating]] = defaultdict(list)
    for r in att:
        by_target[r.meta["target"]].append(r)
    if task:
        cands = [t for t in by_target if t.startswith(task)]
    else:
        cands = sorted(by_target, key=lambda t: (max(r.overall for r in by_target[t]) - base[t].overall), reverse=True)
    if not cands:
        raise typer.BadParameter("no attack found")
    t = cands[0] if pick == "best" else cands[-1]
    item, start = swe[t], base[t]
    typer.echo(f"=== {t}\nhidden tests: FAIL\n--- task\n{item.task[:600]}\n--- original description\n{item.description or '(none)'}")
    typer.echo(f"--- {judge} score before: R7={start.overall}  {start.reasons.get('R7', '')}")
    for r in sorted(by_target[t], key=lambda r: r.meta["round"]):
        a = items[r.item_id]
        tf = [f for f in a.diff.split("diff --git ")[1:] if f not in item.diff]
        typer.echo(f"\n=== round {r.meta['round']}: R7={r.overall}  {r.reasons.get('R7', '')}")
        typer.echo(f"--- rewritten description\n{a.description}")
        if tf:
            typer.echo(f"--- added test file (source hunks byte-identical)\n{tf[-1][:2500]}")


@app.command("attack-transfer")
def attack_transfer(src: str, dst: str, judges: str = "configs/judges.yaml", workers: int = 8):
    """Rate the attacked items tuned against judge SRC with judge DST (transfer test)."""
    items = read_jsonl(RESULTS / src / "attack_items.jsonl", Item)
    _rate_set(items, f"attack_xfer_from_{src}.jsonl", judges, [dst], workers)


@app.command("verify")
def verify_cmd(split_name: str = "test", workers: int = 3, keep_images: bool = False):
    """Fail-to-pass check of every SWE patch and attacked patch in the SWE-bench containers."""
    import subprocess
    from concurrent.futures import ThreadPoolExecutor

    from .verify import image_for, load_cache, pull_image, verify

    split = json.loads((DATA / "swe" / "split.json").read_text())
    items = [i for i in read_jsonl(DATA / "swe" / "items.jsonl", Item) + read_jsonl(DATA / "swe" / "pool_items.jsonl", Item)
             if split.get(i.parent_id) == split_name]
    for f in sorted(RESULTS.glob("*/attack*_items.jsonl")):
        items += [i for i in read_jsonl(f, Item) if split.get(i.parent_id) == split_name]
    cache = load_cache()
    by_task: dict[str, list[Item]] = defaultdict(list)
    seen = set()
    for i in items:
        if (i.parent_id, i.diff) not in seen:
            seen.add((i.parent_id, i.diff))
            by_task[i.parent_id].append(i)
    typer.echo(f"{sum(map(len, by_task.values()))} distinct patches over {len(by_task)} tasks")

    def do_task(pid: str) -> None:
        todo = [i for i in by_task[pid] if verify.__globals__["_key"](pid, i.diff) not in cache]
        if not todo:
            return
        if not pull_image(image_for(pid)):
            typer.echo(f"{pid}: image pull failed, skipped")
            return
        for i in todo:
            r = verify(pid, i.diff, cache=cache, pull=False)
            typer.echo(f"{i.id}: {r['verdict']}")
        if not keep_images:
            subprocess.run(check=False, args=["docker", "rmi", "-f", image_for(pid)], capture_output=True)

    with ThreadPoolExecutor(workers) as ex:
        list(ex.map(do_task, sorted(by_task)))
    from collections import Counter
    typer.echo(Counter(v["verdict"] for v in cache.values()))


@app.command("ext-build")
def ext_build(prb: str = "~/ext/prb", bcr: str = "~/ext/bcr/sample200.json"):
    """Human-labelled external sets -> data/ext/ (SWE-PRBench, BigCodeReward)."""
    from jbc.ext import bcr_items, prb_items

    out = DATA / "ext"
    out.mkdir(parents=True, exist_ok=True)
    items, labels = prb_items(Path(prb).expanduser())
    write_jsonl(out / "prb_items.jsonl", items)
    dump_json(out / "prb_labels.json", labels)
    b_items, votes = bcr_items(Path(bcr).expanduser())
    write_jsonl(out / "bcr_items.jsonl", b_items)
    dump_json(out / "bcr_votes.json", votes)
    typer.echo(f"prb {len(items)} PRs ({sum(v['requested_changes'] for v in labels.values())} changes requested); "
               f"bcr {len(votes)} battles")


@app.command("ext-run")
def ext_run(judges: str = "configs/judges.yaml", only: list[str] | None = typer.Option(None), workers: int = 8):
    for name in ("prb", "bcr"):
        _rate_set(read_jsonl(DATA / "ext" / f"{name}_items.jsonl", Item), f"{name}_ratings.jsonl", judges, only, workers)


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
        attack_metrics,
        best_cutoff,
        best_of_n_curve,
        ext_metrics,
        failures,
        goodhart_curve,
        judge_scorecard,
        merge_auroc,
        rank_robustness,
        swe_metrics,
        test_touching_metrics,
        transfer_metrics,
    )

    op = DATA / "agent_outcomes.json"
    outcomes = json.loads(op.read_text()) if op.exists() else {}

    from jbc.stats import deltas, perturbation_effects

    swe_dir = DATA / "swe"
    swe_out = json.loads((swe_dir / "outcomes.json").read_text()) if (swe_dir / "outcomes.json").exists() else {}
    swe_split = json.loads((swe_dir / "split.json").read_text()) if (swe_dir / "split.json").exists() else {}
    pp = swe_dir / "pool_outcomes.json"
    pool_out = json.loads(pp.read_text()) if pp.exists() else {}

    items, pairs = _items(), _pairs()
    swe_items = read_jsonl(swe_dir / "items.jsonl", Item) if (swe_dir / "items.jsonl").exists() else []
    pool_items = read_jsonl(swe_dir / "pool_items.jsonl", Item) if (swe_dir / "pool_items.jsonl").exists() else []
    board, fails = {}, []
    for d in sorted(p for p in RESULTS.iterdir() if p.is_dir()):
        ratings = read_jsonl(d / "ratings.jsonl", Rating)
        prefs = read_jsonl(d / "prefs.jsonl", Pref)
        if not ratings and not prefs and not (d / "swe_ratings.jsonl").exists():
            continue
        board[d.name] = judge_scorecard(items, pairs, ratings, prefs, read_jsonl(d / "retest.jsonl", Rating))
        board[d.name]["mixed_effects"] = perturbation_effects(deltas(items, ratings))
        swe = read_jsonl(d / "swe_ratings.jsonl", Rating)
        if swe and swe_out:
            cut = best_cutoff(swe, swe_out, swe_split, "dev")
            board[d.name]["swe_cutoff"] = cut
            board[d.name]["metrics"].update(swe_metrics(swe, swe_out, swe_split, "test", cut))
            board[d.name]["swe_dev"] = swe_metrics(swe, swe_out, swe_split, "dev")
            pool = read_jsonl(d / "swe_pool_ratings.jsonl", Rating)
            att = read_jsonl(d / "attack.jsonl", Rating)
            if pool and pool_out:
                board[d.name]["best_of_n"] = best_of_n_curve(swe + pool, {**swe_out, **pool_out}, swe_split)
                board[d.name]["goodhart"] = goodhart_curve(swe + pool, att, {**swe_out, **pool_out}, swe_split)
                board[d.name]["metrics"].update(test_touching_metrics(
                    swe + pool, swe_items + pool_items, {**swe_out, **pool_out}, swe_split))
            board[d.name]["metrics"].update(ext_metrics(d))
            for xf in sorted(d.glob("attack_xfer_from_*.jsonl")):
                board[d.name]["attack_transfer_src"] = xf.stem.removeprefix("attack_xfer_from_")
                board[d.name]["metrics"].update(transfer_metrics(read_jsonl(xf, Rating), swe))
            if att:
                board[d.name]["metrics"].update(
                    attack_metrics(att, swe, swe_out, read_jsonl(d / "attack_pass.jsonl", Rating)))
                board[d.name]["attack_cost_usd"] = sum(r.cost_usd + r.meta.get("attacker_cost_usd", 0) for r in att)
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
