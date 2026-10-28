"""Bundle results into static JSON for the site."""
from __future__ import annotations

import json
from collections import defaultdict
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
    plan = Path("docs/analysis_plan.md")
    if plan.exists():
        (out.parent / "analysis_plan.md").write_text(plan.read_text())
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
    (out / "demo.json").write_text(json.dumps({"attacks": _demo_attacks()}))


DEMO_JUDGES = ("rubric-gpt6.1-sol", "rubric-gpt6-luna", "rubricx-gpt6.1-sol", "rubricx-gpt6-luna")


def _demo_attacks(judges: tuple[str, ...] = DEMO_JUDGES, per_judge: int = 3) -> list[dict]:
    """Cached adaptive attacks with the largest score lift, for the step-through demo."""
    from jbc.verify import lookup

    swe_path = DATA / "swe" / "items.jsonl"
    if not swe_path.exists():
        return []
    swe = {i.id: i for i in read_jsonl(swe_path, Item)}
    out: list[dict] = []
    for j in judges:
        d = RESULTS / j
        if not (d / "attack.jsonl").exists():
            continue
        base = {r.item_id: r for r in read_jsonl(d / "swe_ratings.jsonl", Rating)}
        attacked = {i.id: i for i in read_jsonl(d / "attack_items.jsonl", Item)}
        by_target: dict[str, list[Rating]] = defaultdict(list)
        for r in read_jsonl(d / "attack.jsonl", Rating):
            by_target[r.meta["target"]].append(r)
        targets = [t for t in by_target if t in base and t in swe]
        targets.sort(key=lambda t: (max(r.overall for r in by_target[t]) - base[t].overall, -len(swe[t].diff)), reverse=True)
        for t in targets[:per_judge]:
            item, start = swe[t], base[t]
            rounds = []
            for r in sorted(by_target[t], key=lambda r: r.meta["round"]):
                a = attacked.get(r.item_id)
                if not a:
                    continue
                added = [f for f in a.diff.split("diff --git ")[1:] if f not in item.diff]
                v = lookup(a)
                rounds.append({
                    "round": r.meta["round"], "r7": r.overall, "reason": r.reasons.get("R7", ""),
                    "description": a.description[:5000],
                    "test_file": ("diff --git " + added[-1])[:8000] if added else "",
                    "verdict": v["verdict"] if v else None,
                })
            out.append({
                "judge": j, "target": t, "repo": t.split("#")[0], "url": item.url, "task": item.task[:3000],
                "description": item.description or "", "diff": item.diff[:MAX_DIFF],
                "before": {"r7": start.overall, "reason": start.reasons.get("R7", "")}, "rounds": rounds,
            })
    return out
