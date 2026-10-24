"""Minimal unified-diff model: parse, edit, re-render with correct hunk counts."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$")
TEST_PATH_RE = re.compile(
    r"(^|/)(tests?|__tests__|spec|testing)/|(^|/)test_[^/]*\.py$|_test\.(py|go)$|"
    r"\.(test|spec)\.[jt]sx?$|(^|/)tests?\.rs$"
)


@dataclass
class Hunk:
    old_start: int
    new_start: int
    section: str
    lines: list[str] = field(default_factory=list)

    def render(self) -> str:
        old = sum(1 for ln in self.lines if ln[:1] in (" ", "-"))
        new = sum(1 for ln in self.lines if ln[:1] in (" ", "+"))
        head = f"@@ -{self.old_start},{old} +{self.new_start},{new} @@{self.section}"
        return "\n".join([head, *self.lines])


@dataclass
class FileDiff:
    path: str
    header: list[str]
    hunks: list[Hunk] = field(default_factory=list)

    def render(self) -> str:
        return "\n".join([*self.header, *(h.render() for h in self.hunks)])

    @property
    def added(self) -> list[str]:
        return [ln[1:] for h in self.hunks for ln in h.lines if ln.startswith("+")]


def parse_diff(text: str) -> list[FileDiff]:
    files: list[FileDiff] = []
    cur: FileDiff | None = None
    hunk: Hunk | None = None
    for ln in text.splitlines():
        if ln.startswith("diff --git "):
            m = re.match(r"diff --git a/(.*) b/(.*)$", ln)
            cur = FileDiff(path=m.group(2) if m else ln.split()[-1], header=[ln])
            files.append(cur)
            hunk = None
            continue
        if cur is None:
            continue
        m = HUNK_RE.match(ln)
        if m:
            hunk = Hunk(int(m.group(1)), int(m.group(3)), m.group(5))
            cur.hunks.append(hunk)
        elif hunk is None:
            cur.header.append(ln)
        else:
            hunk.lines.append(ln)
    return files


def render_diff(files: list[FileDiff]) -> str:
    return "\n".join(f.render() for f in files) + "\n"


def is_test_path(path: str) -> bool:
    return bool(TEST_PATH_RE.search(path))


def changed_lines(files: list[FileDiff]) -> int:
    return sum(1 for f in files for h in f.hunks for ln in h.lines if ln[:1] in "+-")


def new_file_diff(path: str, old_lines: list[str], new_lines: list[str], start: int) -> FileDiff:
    """Single-hunk diff replacing old_lines with new_lines starting at 1-based line `start`."""
    header = [f"diff --git a/{path} b/{path}", f"--- a/{path}", f"+++ b/{path}"]
    hunk = Hunk(start, start, "")
    i = 0
    while i < len(old_lines) and i < len(new_lines) and old_lines[i] == new_lines[i]:
        i += 1
    hunk.lines += [" " + x for x in old_lines[:i]]
    j_old, j_new = len(old_lines), len(new_lines)
    tail = []
    while j_old > i and j_new > i and old_lines[j_old - 1] == new_lines[j_new - 1]:
        j_old -= 1
        j_new -= 1
        tail.insert(0, " " + old_lines[j_old])
    hunk.lines += ["-" + x for x in old_lines[i:j_old]]
    hunk.lines += ["+" + x for x in new_lines[i:j_new]]
    hunk.lines += tail
    return FileDiff(path, header, [hunk])
