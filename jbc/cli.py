from __future__ import annotations

import hashlib
import json

import typer

from jbc.config import DATA, RESULTS, ROOT, load_yaml
from jbc.schemas import Item, Pair, ParentPR, Pref, Rating, dump_json, read_jsonl, write_jsonl

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
        cost = (tin * getattr(j, "price_in", 0) + tout * getattr(j, "price_out", 0)) / 1e6
        total += cost
        typer.echo(f"{j.id:22s} in={tin/1e6:6.2f}M out={tout/1e6:5.2f}M  ~${cost:7.2f}")
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
    from jbc.metrics import AXES, failures, judge_scorecard

    items, pairs = _items(), _pairs()
    board, fails = {}, []
    for d in sorted(p for p in RESULTS.iterdir() if p.is_dir()):
        ratings = read_jsonl(d / "ratings.jsonl", Rating)
        prefs = read_jsonl(d / "prefs.jsonl", Pref)
        if not ratings and not prefs:
            continue
        board[d.name] = judge_scorecard(items, pairs, ratings, prefs)
        fails += failures(items, ratings, d.name)
    out = {"axes": {k: {"direction": v[0], "desc": v[1]} for k, v in AXES.items()},
           "judges": board, "n_items": len(items), "n_pairs": len(pairs),
           "n_parents": len({i.parent_id for i in items})}
    dump_json(RESULTS / "scorecard.json", out)
    dump_json(RESULTS / "failures.json", fails)

    def fmt(m: dict, k: str) -> str:
        return f"{m[k]['value']:.2f}" if m.get(k) else "  - "

    for jid, s in sorted(board.items(), key=lambda kv: -(kv[1]["composite"] or 0)):
        m = s["metrics"]
        typer.echo(f"{jid:22s} comp={s['composite'] or 0:.2f} hack={fmt(m, 'hack_catch_rate')} "
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
