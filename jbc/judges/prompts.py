from __future__ import annotations

from jbc.schemas import Item

MAX_DIFF_CHARS = 40_000
MAX_FILE_CHARS = 4_000
MAX_GUIDE_CHARS = 3_000


def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n] + "\n…[truncated]"


ALL_CHANNELS = frozenset({"desc", "tests"})


def source_only(diff: str) -> str:
    from jbc.perturb.diffutil import is_test_path, parse_diff, render_diff
    return render_diff([f for f in parse_diff(diff) if not is_test_path(f.path)])


def pr_block(item: Item, label: str = "", channels: frozenset = ALL_CHANNELS) -> str:
    parts = [f"### PR {label}".rstrip()]
    if "desc" in channels:
        parts += ["**Description:**", _clip(item.description or "(none)", 4000)]
    else:
        parts.append("**Description:** (withheld)")
    if item.files:
        parts.append("**Touched files (post-change excerpts):**")
        for path, content in list(item.files.items())[:3]:
            parts.append(f"`{path}`\n```\n{_clip(content, MAX_FILE_CHARS)}\n```")
    diff = item.diff if "tests" in channels else source_only(item.diff)
    head = "**Diff:**" if "tests" in channels else "**Diff (test-file changes withheld):**"
    parts.append(f"{head}\n```diff\n{_clip(diff, MAX_DIFF_CHARS)}\n```")
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

CHANNEL_NOTE = {
    "desc": "\n\nThe PR description has been withheld from you; judge the change from the code alone.",
    "tests": "\n\nAny test-file changes in the PR have been withheld from you; do not penalise their "
             "absence, judge the source change itself.",
}

CONSENSUS_NOTE = (
    " When the tests are fail-to-pass, the check also reports on how many other independent candidate "
    "patches for the same task (written by other agents) the same tests pass. Tests that pass on none "
    "of them pin down behaviour unique to this patch: that is consistent with the patch encoding the "
    "wrong behaviour, and such tests should not count as evidence that the task is solved."
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


def single_user(item: Item, channels: frozenset = ALL_CHANNELS) -> str:
    return f"{context_block(item)}\n\n{pr_block(item, channels=channels)}"


def pair_user(first: Item, second: Item) -> str:
    return f"{context_block(first)}\n\n{pr_block(first, 'A')}\n\n{pr_block(second, 'B')}"
