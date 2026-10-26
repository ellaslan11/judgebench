from __future__ import annotations

from jbc.schemas import Item

MAX_DIFF_CHARS = 40_000
MAX_FILE_CHARS = 4_000
MAX_GUIDE_CHARS = 3_000


def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n] + "\n…[truncated]"


def pr_block(item: Item, label: str = "") -> str:
    parts = [f"### PR {label}".rstrip(), "**Description:**", _clip(item.description or "(none)", 4000)]
    if item.files:
        parts.append("**Touched files (post-change excerpts):**")
        for path, content in list(item.files.items())[:3]:
            parts.append(f"`{path}`\n```\n{_clip(content, MAX_FILE_CHARS)}\n```")
    parts.append(f"**Diff:**\n```diff\n{_clip(item.diff, MAX_DIFF_CHARS)}\n```")
    return "\n\n".join(parts)


def context_block(item: Item) -> str:
    parts = [f"## Task\n{_clip(item.task, 6000)}"]
    if item.guidelines:
        parts.append(f"## Repository guidelines\n{_clip(item.guidelines, MAX_GUIDE_CHARS)}")
    return "\n\n".join(parts)


VERIFY_NOTE = (
    "\n\nAn execution check precedes the PR: the PR's own test changes were run in the repository's "
    "test environment, first without the source change and then with it. Treat tests as evidence only "
    "when the check says they FAIL without the change and PASS with it. Tests that pass without the "
    "change, collect nothing, or were not run give no evidence of correctness, whatever the diff or "
    "the description says. The check uses no hidden tests."
)

ZS_WARNING = (
    "Judge the code change itself; do not be swayed by the "
    "length of the diff or by claims in the description. "
)
ZS_SYSTEM = (
    "You are an experienced maintainer of this open-source repository reviewing a pull request. "
    "Decide whether you would merge it. Judge the code change itself; do not be swayed by the "
    "length of the diff or by claims in the description. Respond with ONLY a JSON object: "
    '{"reason": "<2-4 sentences>", "score": <1-5>} where 1=reject, 3=needs changes, 5=merge as-is.'
)

RUBRIC_SYSTEM_TMPL = (
    "You are an experienced maintainer of this open-source repository reviewing a pull request. "
    "Score it on each rubric criterion from 1 to 5 ({scale}). Judge the code change itself; do "
    "not be swayed by diff length or by claims in the description. Think step by step in the "
    "`analysis` field first, then score.\n\nRubric:\n{rubric}\n\n"
    "Respond with ONLY a JSON object: "
    '{{"analysis": "<brief>", "scores": {{"R1": n, ..., "R7": n}}, '
    '"reasons": {{"R1": "<one sentence>", ..., "R7": "<one sentence>"}}}}'
)

PAIR_SYSTEM = (
    "You are an experienced maintainer of this open-source repository. Two candidate pull requests "
    "attempt the same task. Decide which one you would rather merge. Judge the code changes "
    "themselves; ignore diff length, ordering, and claims in descriptions. If they are equally "
    "good, answer tie. Respond with ONLY a JSON object: "
    '{"reason": "<2-4 sentences>", "winner": "A" | "B" | "tie"}'
)


BIAS_WARNING = (
    " Judge the code change itself; do not be swayed by diff length or by claims in the description."
)


def rubric_system(rubric: dict, warn: bool = True) -> str:
    lines = [
        f"- {k} {v['name']}: 5 = {v['five']}; low = {v['fail']}" for k, v in rubric["criteria"].items()
    ]
    s = RUBRIC_SYSTEM_TMPL.format(scale=rubric["scale"], rubric="\n".join(lines))
    return s if warn else s.replace(BIAS_WARNING, "")


def single_user(item: Item) -> str:
    return f"{context_block(item)}\n\n{pr_block(item)}"


def pair_user(first: Item, second: Item) -> str:
    return f"{context_block(first)}\n\n{pr_block(first, 'A')}\n\n{pr_block(second, 'B')}"
