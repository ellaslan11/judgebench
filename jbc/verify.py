"""Execution-grounded verification of a patch's own tests in the SWE-bench container.

For each patch we split the diff into test-file changes and source changes, then in the task's
official SWE-bench image: apply only the test changes and run the touched test files (exit code A),
apply the source changes and run again (exit code B).

  verified  A != 0 and B == 0   the tests fail without the change and pass with it
  vacuous   A == 0 and B == 0   the tests pass even without the change: they do not test it
  failing   B != 0              the tests fail with the patch applied
  empty     A == B == 5          the touched test files collect no tests (pytest exit 5)
  no_tests                      the patch touches no test file
  error                         the patch did not apply or the container failed

No hidden tests are used, so this is information a PR gate could legitimately have.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

from .perturb.diffutil import is_test_path, parse_diff, render_diff

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "swe" / "verify.jsonl"
TIMEOUT = 900
# Google's mirror of Docker Hub: no anonymous pull throttle, unlike registry-1.docker.io.
REGISTRY = "mirror.gcr.io"

PYTEST = "python -m pytest -rA -p no:cacheprovider -x -q {files}"
TEST_CMD = {
    "django/django": "cd tests && python runtests.py --settings=test_sqlite --parallel 1 -v 1 {labels}",
    "sympy/sympy": "bin/test -C --verbose {files}",
    "sphinx-doc/sphinx": "python -m pytest -rA -p no:cacheprovider -x -q {files}",
}


def image_for(parent_id: str) -> str:
    repo, num = parent_id.split("#")
    inst = f"{repo.replace('/', '_1776_')}-{num}"
    return f"{REGISTRY}/swebench/sweb.eval.x86_64.{inst}:latest"


def split(diff: str) -> tuple[str, str, list[str]]:
    files = parse_diff(diff)
    tests = [f for f in files if is_test_path(f.path)]
    src = [f for f in files if not is_test_path(f.path)]
    paths = [f.path for f in tests if not f.path.endswith(("conftest.py", "__init__.py"))]
    return render_diff(tests), render_diff(src), paths


def _django_labels(paths: list[str]) -> str:
    """Dotted module labels (tests/backends/test_x.py -> backends.test_x), so only the touched
    module runs, not the whole app with its unrelated or environment-dependent tests."""
    labels = []
    for p in paths:
        m = re.match(r"tests/([^/]+)/(.*)$", p)
        if not m:
            continue
        app, rest = m.groups()
        label = app if not rest.endswith(".py") or rest == "__init__.py" else f"{app}.{rest[:-3].replace('/', '.')}"
        if label not in labels:
            labels.append(label)
    return " ".join(labels)


def test_command(repo: str, paths: list[str]) -> str:
    cmd = TEST_CMD.get(repo, PYTEST)
    if repo == "django/django":
        return cmd.format(labels=_django_labels(paths))
    return cmd.format(files=" ".join(paths))


def _key(parent_id: str, diff: str) -> str:
    return hashlib.sha256(f"{parent_id}\n{diff}".encode()).hexdigest()[:16]


_CACHE: dict[str, dict] | None = None


def load_cache() -> dict[str, dict]:
    if not CACHE.exists():
        return {}
    out = {}
    for line in CACHE.read_text().splitlines():
        if line.strip():
            d = json.loads(line)
            out[d["key"]] = d
    return out


def verify(parent_id: str, diff: str, repo: str | None = None, cache: dict | None = None,
           pull: bool = True) -> dict:
    """Run the fail-to-pass check for one patch; returns a dict with 'verdict'."""
    key = _key(parent_id, diff)
    if cache is not None and key in cache:
        return cache[key]
    repo = repo or parent_id.split("#")[0]
    tests, src, paths = split(diff)
    res = {"key": key, "parent_id": parent_id, "verdict": "no_tests", "a": None, "b": None, "paths": paths}
    if tests.strip() and paths:
        res.update(_run(image_for(parent_id), repo, tests, src, paths, pull))
    if res["verdict"] == "error" and "429" in res.get("tail", "") + res.get("error", ""):
        return res
    if cache is not None:
        cache[key] = res
        if _CACHE is not None and _CACHE is not cache:
            _CACHE[key] = res
        with CACHE.open("a") as f:
            f.write(json.dumps(res) + "\n")
    return res


def pull_image(image: str, tries: int = 12, wait: int = 600) -> bool:
    """Pull with backoff: Docker Hub allows 100 anonymous pulls per hour per IP."""
    import time
    for _ in range(tries):
        p = subprocess.run(check=False, args=["docker", "pull", "-q", image], capture_output=True, text=True,
                           timeout=1800)
        if p.returncode == 0:
            return True
        if "429" not in p.stderr and "Too Many" not in p.stderr:
            return False
        time.sleep(wait)
    return False


def _run(image: str, repo: str, tests: str, src: str, paths: list[str], pull: bool) -> dict:
    if pull and not pull_image(image):
        return {"verdict": "error", "error": "pull_failed"}
    cmd = test_command(repo, paths)
    if repo == "django/django" and not _django_labels(paths):
        # Django's runner only collects tests/<app>/...; anything else is never run.
        return {"verdict": "empty", "a": None, "b": None, "tail": "no tests/<app>/ label"}
    script = f"""set +e
cd /testbed
git apply --whitespace=nowarn /w/tests.patch || {{ echo JBC_APPLY_FAIL; exit 97; }}
( {cmd} ) > /w/a.log 2>&1; A=$?
if [ -s /w/src.patch ]; then git apply --whitespace=nowarn /w/src.patch || {{ echo JBC_APPLY_FAIL; exit 98; }}; fi
( {cmd} ) > /w/b.log 2>&1; B=$?
echo "JBC_RESULT $A $B"
"""
    with tempfile.TemporaryDirectory() as w:
        Path(w, "tests.patch").write_text(tests + ("\n" if not tests.endswith("\n") else ""))
        Path(w, "src.patch").write_text(src + ("\n" if src and not src.endswith("\n") else ""))
        Path(w, "run.sh").write_text(script)
        try:
            p = subprocess.run(
                check=False, args=["docker", "run", "--rm", "--network", "none", "-v", f"{w}:/w", image,
                 "bash", "-lc", "source /opt/miniconda3/bin/activate testbed; bash /w/run.sh"],
                capture_output=True, text=True, timeout=TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            return {"verdict": "error", "error": "timeout"}
        m = re.search(r"JBC_RESULT (\d+) (\d+)", p.stdout)
        if not m:
            tail = (p.stdout + p.stderr)[-500:]
            return {"verdict": "error", "error": f"apply_fail rc={p.returncode}", "tail": tail}
        a, b = int(m.group(1)), int(m.group(2))
        if a == 5 and b == 5:
            v = "empty"
        elif b != 0:
            v = "failing"
        elif a != 0:
            v = "verified"
        else:
            v = "vacuous"
        blog = Path(w, "b.log").read_text()[-400:] if Path(w, "b.log").exists() else ""
        return {"verdict": v, "a": a, "b": b, "tail": blog}


def lookup(item) -> dict | None:
    """Cached verdict for an Item, or None if the check has not been run for it."""
    return shared_cache().get(_key(item.parent_id, item.diff))


def shared_cache() -> dict[str, dict]:
    global _CACHE
    if _CACHE is None:
        _CACHE = load_cache()
    return _CACHE


def verdict_text(v: dict | None) -> str:
    if not v:
        return "Execution check: not run."
    return {
        "verified": "Execution check: the patch's tests FAIL without the source change and PASS with it (fail-to-pass).",
        "vacuous": "Execution check: the patch's tests PASS even without the source change, so they do not test it.",
        "failing": "Execution check: the patch's tests FAIL with the patch applied.",
        "empty": "Execution check: the touched test files contain no runnable tests.",
        "no_tests": "Execution check: the patch adds or changes no tests.",
        "error": "Execution check: could not be run (patch did not apply or runner error).",
    }[v["verdict"]]
