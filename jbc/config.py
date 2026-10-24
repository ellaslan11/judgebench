from __future__ import annotations

import os
import re
from pathlib import Path

import yaml

ROOT = Path(os.environ.get("JBC_ROOT", Path.cwd()))
DATA = ROOT / "data"
RESULTS = ROOT / "results"
CONFIGS = ROOT / "configs"

_ENV = re.compile(r"\$\{(\w+)\}")


def _expand(v):
    if isinstance(v, str):
        return _ENV.sub(lambda m: os.environ.get(m.group(1), ""), v)
    if isinstance(v, dict):
        return {k: _expand(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_expand(x) for x in v]
    return v


def load_yaml(path: Path) -> dict:
    return _expand(yaml.safe_load(path.read_text()))
