"""Execution-labelled candidates: real agent patches for SWE-bench Verified tasks.

Labels come from SWE-bench's hidden tests (each submission's `results.json`), not from us. We keep
tasks where the chosen submissions disagree, and take 2 resolved + 2 unresolved patches per task, so
every task supports a within-task comparison and a best-of-4 pick.
"""

from __future__ import annotations

import hashlib
import json
import random
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from jbc.schemas import Item

S3 = "https://swe-bench-submissions.s3.amazonaws.com/verified/{sub}/logs/{iid}/patch.diff"

# Spread of agent scaffolds and model sizes, 190-396 resolved of 500.
SUBMISSIONS = [
    "20250725_sweagent_devstral_small_2507",
    "20251110_frogmini-14b",
    "20250901_entroPO_R2E_QwenCoder30BA3B",
    "20250804_codesweep_sweagent_kimi_k2_instruct",
    "20250924_artemis_agent_v2",
    "20250807_openhands_gpt5",
    "20251014_Lingxi_kimi_k2",
    "20250915_JoyCode",
    "20250928_trae_doubao_seed_code",
    "20251120_livesweagent_gemini-3-pro-preview",
    "20251215_livesweagent_claude-opus-4-5",
]
REPO_CAP = {"django/django": 25, "sympy/sympy": 12}
DEFAULT_CAP = 10
MAX_DIFF_CHARS = 40_000
DEV_SHARE = 0.3


def split_of(parent_id: str) -> str:
    h = int(hashlib.sha256(parent_id.encode()).hexdigest()[:8], 16)
    return "dev" if (h % 1000) / 1000 < DEV_SHARE else "test"


def _get(url: str) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return None


def parent_id(task: dict) -> str:
    return f"{task['repo']}#{task['instance_id'].rsplit('-', 1)[1]}"


def collect(experiments: Path, tasks: list[dict], seed: int = 0, per_side: int = 2, log=print
            ) -> tuple[list[Item], dict[str, bool]]:
    resolved = {s: set(json.loads((experiments / s / "results" / "results.json").read_text())["resolved"])
                for s in SUBMISSIONS}
    rng = random.Random(seed)
    by_repo: dict[str, list[dict]] = defaultdict(list)
    for t in tasks:
        k = sum(t["instance_id"] in resolved[s] for s in SUBMISSIONS)
        if per_side <= k <= len(SUBMISSIONS) - per_side:
            by_repo[t["repo"]].append(t)
    chosen = []
    for repo, ts in sorted(by_repo.items()):
        rng.shuffle(ts)
        chosen += ts[: REPO_CAP.get(repo, DEFAULT_CAP)]

    def pick(t: dict) -> list[tuple[str, bool, str]]:
        iid = t["instance_id"]
        out = []
        for want in (True, False):
            subs = [s for s in SUBMISSIONS if (iid in resolved[s]) == want]
            random.Random(f"{seed}:{iid}:{want}").shuffle(subs)
            seen: set[str] = set()
            for s in subs:
                d = _get(S3.format(sub=s, iid=iid))
                if not d or not d.strip() or len(d) > MAX_DIFF_CHARS or d in seen:
                    continue
                seen.add(d)
                out.append((s, want, d))
                if len(seen) == per_side:
                    break
        return out

    items, outcome = [], {}
    with ThreadPoolExecutor(16) as ex:
        for t, cands in zip(chosen, ex.map(pick, chosen)):
            if sum(c[1] for c in cands) < per_side or sum(not c[1] for c in cands) < per_side:
                log(f"  skip {t['instance_id']}: not enough usable patches")
                continue
            pid = parent_id(t)
            for s, ok, d in cands:
                iid = f"{pid}::swe::{s}"
                items.append(Item(
                    id=iid, parent_id=pid, perturbation="swe_patch", category="control",
                    expected="baseline", task=t["problem_statement"][:6000], description="",
                    diff=d, language="python", url=f"https://github.com/{t['repo']}/tree/{t['base_commit']}",
                    label_source="execution",
                ))
                outcome[iid] = ok
            log(f"  {t['instance_id']}: {len(cands)} patches")
    return items, outcome
