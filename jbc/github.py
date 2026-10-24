"""Fetch merged PRs (diff, task, guidelines, file context) from the GitHub REST API."""
from __future__ import annotations

import base64
import os
import re
import time
from datetime import datetime, timedelta, timezone

import httpx

from jbc.perturb.diffutil import changed_lines, is_test_path, parse_diff
from jbc.perturb.ops import UNRELATED_KEY
from jbc.schemas import ParentPR

API = "https://api.github.com"
EXT = {"python": (".py",), "typescript": (".ts", ".tsx"), "go": (".go",), "rust": (".rs",)}
SKIP_FILES = re.compile(r"(lock|\.lock|\.snap|\.min\.js)$", re.IGNORECASE)
DOC_FILES = re.compile(r"\.(md|mdx|rst|txt|svg|png)$", re.IGNORECASE)
FIX_RE = re.compile(r"(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)", re.IGNORECASE)


class GH:
    def __init__(self):
        token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self.c = httpx.Client(base_url=API, headers=headers, timeout=30, follow_redirects=True)

    def get(self, path: str, accept: str | None = None, **params):
        for attempt in range(5):
            r = self.c.get(path, params=params, headers={"Accept": accept} if accept else None)
            if r.status_code in (403, 429) and "rate limit" in r.text.lower():
                reset = int(r.headers.get("x-ratelimit-reset", time.time() + 60))
                time.sleep(max(5, min(reset - time.time(), 120)))
                continue
            if r.status_code >= 500:
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            return r.text if accept and "diff" in accept else r.json()
        r.raise_for_status()

    def file(self, repo: str, path: str, ref: str) -> str | None:
        try:
            d = self.get(f"/repos/{repo}/contents/{path}", ref=ref)
        except httpx.HTTPStatusError:
            return None
        if isinstance(d, dict) and d.get("encoding") == "base64":
            return base64.b64decode(d["content"]).decode("utf-8", errors="replace")
        return None


def _guidelines(gh: GH, repo: str, ref: str) -> str | None:
    for p in ("AGENTS.md", "CONTRIBUTING.md", ".github/CONTRIBUTING.md", "docs/CONTRIBUTING.md"):
        txt = gh.file(repo, p, ref)
        if txt:
            return f"[{p}]\n{txt[:3000]}"
    return None


def _task(gh: GH, repo: str, pr: dict) -> str:
    body = pr.get("body") or ""
    m = FIX_RE.search(body)
    if m:
        try:
            issue = gh.get(f"/repos/{repo}/issues/{m.group(1)}")
            if "pull_request" not in issue:
                return f"{issue['title']}\n\n{(issue.get('body') or '')[:5000]}"
        except httpx.HTTPStatusError:
            pass
    return f"{pr['title']}\n\n{body[:3000]}"


def _unrelated_file(gh: GH, repo: str, ref: str, touched: set[str], lang: str) -> tuple[str, str] | None:
    src = [p for p in touched if p.endswith(EXT[lang]) and not is_test_path(p)]
    dirs = sorted({p.rsplit("/", 1)[0] if "/" in p else "" for p in src})
    for d in dirs:
        try:
            listing = gh.get(f"/repos/{repo}/contents/{d}", ref=ref)
        except httpx.HTTPStatusError:
            continue
        cands = sorted(
            x["path"] for x in listing
            if x["type"] == "file" and x["path"].endswith(EXT[lang]) and x["path"] not in touched
            and not is_test_path(x["path"]) and x.get("size", 0) > 400
        )
        if cands:
            path = cands[len(cands) // 2]
            txt = gh.file(repo, path, ref)
            if txt:
                return path, txt[:6000]
    return None


def _merged_prs(gh: GH, repo: str, since: datetime):
    q = f"repo:{repo} is:pr is:merged merged:>={since:%Y-%m-%d}"
    for page in (1, 2, 3):
        items = gh.get("/search/issues", q=q, sort="updated", order="desc", per_page=100, page=page)["items"]
        for it in items:
            yield it["number"], it["user"]["login"]
        if len(items) < 100:
            return


def fetch_repo(gh: GH, repo: str, lang: str, cfg: dict, log=print) -> list[ParentPR]:
    since = datetime.now(timezone.utc) - timedelta(days=cfg["since_days"])
    out: list[ParentPR] = []
    for num, author in _merged_prs(gh, repo, since):
        if len(out) >= cfg["per_repo"]:
            return out
        if author in cfg["exclude_authors"]:
            continue
        pr = gh.get(f"/repos/{repo}/pulls/{num}")
        merged = datetime.fromisoformat(pr["merged_at"].replace("Z", "+00:00"))
        files = gh.get(f"/repos/{repo}/pulls/{num}/files", per_page=100)
        paths = [f["filename"] for f in files]
        code = [p for p in paths if not DOC_FILES.search(p)]
        if not (1 < len(code) <= cfg["max_files"]) or any(SKIP_FILES.search(p) for p in paths):
            continue
        if any("patch" not in f for f in files):
            continue
        tests = [p for p in paths if is_test_path(p)]
        srcs = [p for p in paths if p.endswith(EXT[lang]) and not is_test_path(p)]
        if not tests or not srcs:
            continue
        diff = gh.get(f"/repos/{repo}/pulls/{pr['number']}", accept="application/vnd.github.diff")
        n = changed_lines(parse_diff(diff))
        if not (cfg["min_changed_lines"] <= n <= cfg["max_changed_lines"]):
            continue
        base, head = pr["base"]["sha"], pr["merge_commit_sha"] or pr["head"]["sha"]
        ctx = {}
        for p in srcs[:3]:
            txt = gh.file(repo, p, head)
            if txt:
                ctx[p] = txt[:4000]
        unrel = _unrelated_file(gh, repo, base, set(paths), lang)
        if unrel:
            ctx[UNRELATED_KEY + unrel[0]] = unrel[1]
        out.append(ParentPR(
            id=f"{repo}#{pr['number']}", repo=repo, number=pr["number"], url=pr["html_url"],
            title=pr["title"], body=pr.get("body") or "", task=_task(gh, repo, pr), diff=diff,
            files=ctx, guidelines=_guidelines(gh, repo, base), test_files=tests,
            language=lang, base_sha=base, merged_at=merged,
        ))
        log(f"  + {repo}#{pr['number']} ({n} lines, {len(files)} files)")
    return out
