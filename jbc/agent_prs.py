"""Real agent-authored PRs with maintainer outcomes (merged vs closed-unmerged)."""
from __future__ import annotations

import httpx

from jbc.github import GH
from jbc.perturb.diffutil import changed_lines, parse_diff
from jbc.schemas import Item

AGENTS = ["devin-ai-integration[bot]", "copilot-swe-agent[bot]"]
LANG = {".py": "python", ".ts": "typescript", ".tsx": "typescript", ".js": "typescript",
        ".go": "go", ".rs": "rust"}


def _lang(paths: list[str]) -> str | None:
    for p in paths:
        for ext, lang in LANG.items():
            if p.endswith(ext):
                return lang
    return None


def search(gh: GH, agent: str, state: str, since: str, pages: int = 10):
    q = f"is:pr author:{agent} {state} created:>={since}"
    for page in range(1, pages + 1):
        d = gh.get("/search/issues", q=q, per_page=50, page=page, sort="created", order="desc")
        yield from d.get("items", [])


def collect(gh: GH, since: str, per_bucket: int, min_stars: int = 100, log=print
            ) -> tuple[list[Item], dict[str, bool]]:
    stars: dict[str, int] = {}
    items: list[Item] = []
    outcome: dict[str, bool] = {}
    for agent in AGENTS:
        for state, merged in (("is:merged", True), ("is:unmerged is:closed", False)):
            n = 0
            for it in search(gh, agent, state, since):
                if n >= per_bucket:
                    break
                repo = it["repository_url"].split("/repos/", 1)[1]
                if repo not in stars:
                    try:
                        stars[repo] = gh.get(f"/repos/{repo}").get("stargazers_count", 0)
                    except httpx.HTTPStatusError:
                        stars[repo] = 0
                if stars[repo] < min_stars or it.get("comments", 0) < 1:
                    continue
                num = it["number"]
                try:
                    diff = gh.get(f"/repos/{repo}/pulls/{num}", accept="application/vnd.github.diff")
                except httpx.HTTPStatusError:
                    continue
                files = parse_diff(diff)
                lang = _lang([f.path for f in files])
                if not lang or not (10 <= changed_lines(files) <= 600) or len(files) > 15:
                    continue
                iid = f"{repo}#{num}::agent_pr"
                if iid in outcome:
                    continue
                items.append(Item(
                    id=iid, parent_id=f"{repo}#{num}", perturbation="agent_pr", category="control",
                    expected="baseline", task=it["title"], description=(it.get("body") or "")[:4000],
                    diff=diff, language=lang, url=it["html_url"], label_source="maintainer",
                ))
                outcome[iid] = merged
                n += 1
                log(f"  {agent} {'merged' if merged else 'closed'} {iid}")
    return items, outcome
