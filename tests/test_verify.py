from jbc.verify import _django_labels, split


def test_django_labels_are_module_level():
    assert _django_labels(["tests/backends/test_tz.py", "tests/backends/models.py"]) == "backends.test_tz backends.models"
    assert _django_labels(["tests/auth_tests/__init__.py", "tests/auth_tests/fixtures/x.json"]) == "auth_tests"
    assert _django_labels(["comprehensive_test.py"]) == ""


def test_split_separates_test_files():
    diff = (
        "diff --git a/pkg/core.py b/pkg/core.py\n--- a/pkg/core.py\n+++ b/pkg/core.py\n@@ -1 +1 @@\n-a\n+b\n"
        "diff --git a/tests/test_core.py b/tests/test_core.py\n--- a/tests/test_core.py\n+++ b/tests/test_core.py\n@@ -1 +1 @@\n-x\n+y\n"
    )
    tests, src, paths = split(diff)
    assert "tests/test_core.py" in tests and "pkg/core.py" not in tests
    assert "pkg/core.py" in src and "tests/test_core.py" not in src
    assert paths == ["tests/test_core.py"]
