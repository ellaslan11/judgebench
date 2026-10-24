"""Bundle results into static JSON for the site."""
from __future__ import annotations

import json
from pathlib import Path

from jbc.config import DATA, RESULTS
from jbc.harness import ratings_path
from jbc.schemas import Item, Rating, read_jsonl

MAX_DIFF = 30_000


def _pick_showcase(items: list[Item], ratings: dict[str, dict[str, Rating]], n: int) -> list[str]:
    """Prefer parents with every perturbation and where judges disagree most on hacks."""
    parents: dict[str, set[str]] = {}
    for it in items:
        parents.setdefault(it.parent_id, set()).add(it.perturbation)

    def interest(pid: str) -> tuple:
        swings = 0
        for rs in ratings.values():
            base = rs.get(f"{pid}::none")
            if not base:
                continue
            for pert in ("delete_tests", "skip_tests", "pad", "polish_desc"):
                r = rs.get(f"{pid}::{pert}")
                if r and ((pert in ("delete_tests", "skip_tests") and r.overall >= base.overall)
                          or (pert in ("pad", "polish_desc") and r.overall > base.overall)):
                    swings += 1
        return (len(parents[pid]), swings)

    ranked = sorted(parents, key=interest, reverse=True)
    out, repos = [], set()
    for pid in ranked:
        repo = pid.split("#")[0]
        if repo in repos and len(repos) < len({p.split("#")[0] for p in parents}):
            continue
        out.append(pid)
        repos.add(repo)
        if len(out) >= n:
            break
    return out


def export_site(out: Path, showcase: int = 10) -> None:
    out.mkdir(parents=True, exist_ok=True)
    items = read_jsonl(DATA / "items.jsonl", Item)
    judge_ids = sorted(p.name for p in RESULTS.iterdir() if p.is_dir())
    ratings = {j: {r.item_id: r for r in read_jsonl(ratings_path(j), Rating)} for j in judge_ids}
    for name in ("scorecard.json", "failures.json"):
        src = RESULTS / name
        (out / name).write_text(src.read_text() if src.exists() else "{}")

    by_parent: dict[str, list[Item]] = {}
    for it in items:
        by_parent.setdefault(it.parent_id, []).append(it)
    show = _pick_showcase(items, ratings, showcase)
    fails = json.loads((RESULTS / "failures.json").read_text()) if (RESULTS / "failures.json").exists() else []
    needed = set(show) | {f["parent_id"] for f in fails}

    playground = []
    for pid in sorted(needed):
        variants = []
        for it in by_parent.get(pid, []):
            variants.append({
                "id": it.id, "perturbation": it.perturbation, "category": it.category,
                "expected": it.expected, "description": it.description[:4000],
                "diff": it.diff[:MAX_DIFF],
                "ratings": {
                    j: {"r7": rs[it.id].overall, "scores": rs[it.id].scores,
                        "reason": rs[it.id].reasons.get("R7", "")}
                    for j, rs in ratings.items() if it.id in rs
                },
            })
        first = by_parent[pid][0]
        playground.append({"parent_id": pid, "url": first.url, "language": first.language,
                           "task": first.task[:3000], "showcase": pid in show,
                           "variants": variants})
    (out / "playground.json").write_text(json.dumps(playground))
