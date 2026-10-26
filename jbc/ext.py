"""External human-labelled sets (no hand-made labels):
- SWE-PRBench (foundry-ai/swe-prbench): 350 real PRs; label = a human reviewer formally requested changes.
- BigCodeReward (bigcode/bigcodereward): human A/B votes on two models' programs for the same prompt."""
from __future__ import annotations

import json
from pathlib import Path

from jbc.perturb.diffutil import FileDiff, Hunk, render_diff
from jbc.schemas import Item

MAX_DIFF_CHARS = 40_000


def prb_items(root: Path) -> tuple[list[Item], dict[str, dict]]:
    items, labels = [], {}
    for line in (root / "dataset" / "prs.jsonl").read_text().splitlines():
        r = json.loads(line)
        if not r["diff_patch"].strip() or len(r["diff_patch"]) > MAX_DIFF_CHARS:
            continue
        ann = json.loads((root / "dataset" / "annotations" / f"{r['task_id']}_human.json").read_text())
        iid = f"{r['repo']}#{r['pr_number']}::prb"
        items.append(Item(id=iid, parent_id=f"{r['repo']}#{r['pr_number']}", perturbation="none",
                          category="control", expected="baseline", task=r["title"],
                          description=r["description"] or "", diff=r["diff_patch"],
                          language=r["language"].lower(), url=r["pr_url"], label_source="human"))
        labels[iid] = {"requested_changes": bool(r["has_requested_changes"]),
                       "changes_required": bool(ann["changes_required"])}
    return items, labels


def _answer_item(bid: str, side: str, task: str, text: str) -> Item:
    path = "answer.md"
    f = FileDiff(path, [f"diff --git a/{path} b/{path}", "new file mode 100644", "--- /dev/null", f"+++ b/{path}"],
                 [Hunk(0, 1, "", ["+" + x for x in text.splitlines()])])
    return Item(id=f"bcr/{bid}::{side}", parent_id=f"bcr/{bid}", perturbation="none", category="control",
                expected="baseline", task=task[:6000], description="", diff=render_diff([f]),
                language="mixed", url="https://huggingface.co/datasets/bigcode/bigcodereward", label_source="human")


def bcr_items(sample: Path) -> tuple[list[Item], dict[str, str]]:
    rows = json.loads(sample.read_text())
    items = [_answer_item(r["id"], s, r["task"], r[s.lower()]) for r in rows for s in ("A", "B")]
    return items, {f"bcr/{r['id']}": r["vote"] for r in rows}
