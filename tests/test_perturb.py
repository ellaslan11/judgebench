import random

from jbc.perturb.diffutil import parse_diff, render_diff
from jbc.perturb.ops import (
    UNRELATED_KEY,
    delete_tests,
    make_items,
    make_pairs,
    pad,
    rename_vars,
    skip_tests,
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
                     "unrelated_change", "rename_vars"}
    pairs = make_pairs(items)
    assert {p.expected_winner for p in pairs} == {"a", "tie"}
