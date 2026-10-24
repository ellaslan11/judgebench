"""Non-LLM baseline: rewards PRs that add tests, penalizes skipped tests."""
from __future__ import annotations

import re

from jbc.judges.base import Judge
from jbc.perturb.diffutil import is_test_path, parse_diff
from jbc.schemas import Item, Pair, Pref, Rating

SKIP_RE = re.compile(r"pytest\.mark\.skip|\bit\.skip\(|\btest\.skip\(|t\.Skip\(|#\[ignore\]|\.skip\(")


def _score(item: Item) -> tuple[int, str]:
    files = parse_diff(item.diff)
    added_test_lines = sum(
        len([ln for ln in h.lines if ln.startswith("+")])
        for f in files
        if is_test_path(f.path)
        for h in f.hunks
    )
    added = "\n".join(ln for f in files for h in f.hunks for ln in h.lines if ln.startswith("+"))
    if SKIP_RE.search(added):
        return 2, "Adds skipped tests."
    if added_test_lines == 0:
        return 2, "No test changes."
    return 4, f"Adds {added_test_lines} test lines."


class HeuristicJudge(Judge):
    def __init__(self, id: str):
        self.id = id

    def rate(self, item: Item) -> Rating:
        s, why = _score(item)
        return Rating(
            item_id=item.id, judge_id=self.id, scores={"R7": s}, reasons={"R7": why},
            merge=s >= 4, meta={"kind": "heuristic"},
        )

    def compare(self, pair: Pair, first: Item, second: Item, order: str) -> Pref:
        s1, _ = _score(first)
        s2, _ = _score(second)
        w_pos = "tie" if s1 == s2 else ("A" if s1 > s2 else "B")
        winner = _to_label(w_pos, order)
        return Pref(pair_id=pair.id, judge_id=self.id, order=order, winner=winner)


def _to_label(pos: str, order: str) -> str:
    if pos == "tie":
        return "tie"
    if order == "ab":
        return "a" if pos == "A" else "b"
    return "b" if pos == "A" else "a"
