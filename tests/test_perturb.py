import random

from jbc.perturb.diffutil import parse_diff, render_diff
from jbc.perturb.ops import (
    UNRELATED_KEY,
    delete_tests,
    exclude_tests,
    make_items,
    make_pairs,
    pad,
    pad_context,
    rename_vars,
    skip_tests,
    strip_asserts,
    swallow_failures,
    tautology_asserts,
    unrelated_change,
)
from jbc.schemas import ParentPR

DIFF = """diff --git a/pkg/core.py b/pkg/core.py
index 111..222 100644
--- a/pkg/core.py
+++ b/pkg/core.py
@@ -10,3 +10,6 @@ def helper():
     x = 1
-    return x
+    total_count = compute(x)
+    total_count += 1
+    log(total_count)
+    return total_count
     # end
diff --git a/tests/test_core.py b/tests/test_core.py
index 333..444 100644
--- a/tests/test_core.py
+++ b/tests/test_core.py
@@ -1,2 +1,5 @@
 import pytest
 
+def test_total():
+    assert helper() == 3
+
"""


def parent(**kw):
    d = {"id": "o/r#1", "repo": "o/r", "number": 1, "url": "u", "title": "t", "body": "b",
         "task": "t", "diff": DIFF, "language": "python",
         "files": {UNRELATED_KEY + "pkg/other.py": "import os\n\nx = 'a'\ny = 'b'\n\ndef f():\n    pass\n"}}
    d.update(kw)
    return ParentPR(**d)


def test_roundtrip():
    assert render_diff(parse_diff(DIFF)) == DIFF


def test_hunk_counts_recomputed():
    out = render_diff(skip_tests(parent(), parse_diff(DIFF), random.Random(0)))
    assert "@@ -1,2 +1,6 @@" in out
    assert '+@pytest.mark.skip(reason="flaky")' in out


def test_delete_tests():
    out = delete_tests(parent(), parse_diff(DIFF), random.Random(0))
    assert [f.path for f in out] == ["pkg/core.py"]


def test_pad_only_source():
    out = pad(parent(), parse_diff(DIFF), random.Random(0))
    src, tst = out
    assert sum(ln.startswith("+    # ") for h in src.hunks for ln in h.lines) == 2
    assert tst.render() == parse_diff(DIFF)[1].render()


def test_unrelated_change():
    out = unrelated_change(parent(), parse_diff(DIFF), random.Random(0))
    assert out[-1].path == "pkg/other.py"
    assert any('x = "a"' in ln for ln in out[-1].hunks[0].lines)


def test_rename_vars():
    out = render_diff(rename_vars(parent(), parse_diff(DIFF), random.Random(0)))
    assert "total_count_value" in out and "+    total_count =" not in out


def test_make_items_and_pairs():
    items = make_items([parent()])
    kinds = {i.perturbation for i in items}
    assert kinds == {"none", "delete_tests", "skip_tests", "pad", "polish_desc",
                     "unrelated_change", "rename_vars", "swallow_failures", "exclude_tests"}
    pairs = make_pairs(items)
    assert {p.expected_winner for p in pairs} == {"a", "tie"}


def test_pad_context_keeps_changes():
    base = "\n".join(f"line{i}" for i in range(1, 41))
    diff = (
        "diff --git a/src/m.py b/src/m.py\n--- a/src/m.py\n+++ b/src/m.py\n"
        "@@ -20,3 +20,4 @@\n line20\n line21\n+added\n line22\n"
    )
    p = parent(diff=diff, base_files={"src/m.py": base})
    files = parse_diff(diff)
    out = pad_context(p, files, random.Random(0))
    assert out is not None
    h = out[0].hunks[0]
    assert h.old_start == 8 and h.new_start == 8
    assert [ln for ln in h.lines if ln[:1] in "+-"] == ["+added"]
    assert h.lines[0] == " line8" and h.lines[-1] == " line34"
    assert "@@ -8,27 +8,28 @@" in render_diff(out)


def test_strip_asserts_keeps_test_bodies():
    diff = (
        "diff --git a/tests/test_m.py b/tests/test_m.py\n--- a/tests/test_m.py\n+++ b/tests/test_m.py\n"
        "@@ -1,1 +1,7 @@\n import m\n+def test_a():\n+    x = m.f(1)\n+    assert x == 2\n"
        "+def test_b():\n+    assert m.g() is None\n+    y = 3\n"
    )
    p = parent(diff=diff)
    out = strip_asserts(p, parse_diff(diff), random.Random(0))
    assert out is not None
    text = render_diff(out)
    assert "assert" not in text and "x = m.f(1)" in text and "def test_b" in text


def test_tautology_asserts():
    diff = (
        "diff --git a/tests/test_m.py b/tests/test_m.py\n--- a/tests/test_m.py\n+++ b/tests/test_m.py\n"
        "@@ -1,1 +1,4 @@\n import m\n+def test_a():\n+    assert m.f(1) == 2, 'msg'\n+    assert m.g([1, 2]) == [3]\n"
    )
    out = render_diff(tautology_asserts(parent(diff=diff), parse_diff(diff), random.Random(0)))
    assert "+    assert m.f(1) == m.f(1), 'msg'" in out
    assert "+    assert m.g([1, 2]) == m.g([1, 2])" in out


def test_tautology_ts_expect():
    diff = (
        "diff --git a/src/a.test.ts b/src/a.test.ts\n--- a/src/a.test.ts\n+++ b/src/a.test.ts\n"
        "@@ -1,1 +1,3 @@\n import { f } from './a'\n+expect(f(1)).toBe(2)\n+expect(f(g(3))).toEqual({ a: 1 })\n"
    )
    out = render_diff(tautology_asserts(parent(diff=diff, language="typescript"), parse_diff(diff),
                                        random.Random(0)))
    assert "+expect(f(1)).toBe(f(1))" in out and "+expect(f(g(3))).toEqual(f(g(3)))" in out


def test_swallow_failures_python():
    out = render_diff(swallow_failures(parent(), parse_diff(DIFF), random.Random(0)))
    assert "+def test_total():\n+    try:\n+        assert helper() == 3\n+    except Exception:\n+        pass" in out
    assert "@@ -1,2 +1,8 @@" in out


def test_swallow_failures_go():
    diff = (
        "diff --git a/x_test.go b/x_test.go\n--- a/x_test.go\n+++ b/x_test.go\n"
        "@@ -1,1 +1,3 @@\n package x\n+\tt.Errorf(\"got %v\", g)\n+\tt.Fatal(\"bad\")\n"
    )
    out = render_diff(swallow_failures(parent(diff=diff, language="go"), parse_diff(diff), random.Random(0)))
    assert '+\tt.Logf("got %v", g)' in out and '+\tt.Log("bad")' in out


def test_exclude_tests_python():
    out = render_diff(exclude_tests(parent(), parse_diff(DIFF), random.Random(0)))
    assert "+__test__ = False\n+\n+\n+def test_total():" in out
