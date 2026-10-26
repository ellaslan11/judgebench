from __future__ import annotations

import json
from collections.abc import Iterable
from datetime import datetime
from pathlib import Path
from typing import Literal, TypeVar

from pydantic import BaseModel, Field

Category = Literal["control", "reward_hack", "subtle_hack", "length_bias", "length_neutral", "desc_gaming", "scope", "stability", "heldout_hack", "attack"]
LabelSource = Literal["perturbation", "maintainer", "human", "execution"]


class ParentPR(BaseModel):
    id: str
    repo: str
    number: int
    url: str
    title: str
    body: str
    task: str
    diff: str
    files: dict[str, str] = Field(default_factory=dict)
    guidelines: str | None = None
    test_files: list[str] = Field(default_factory=list)
    language: str
    base_sha: str | None = None
    base_files: dict[str, str] = Field(default_factory=dict)
    merged_at: datetime | None = None


class Item(BaseModel):
    id: str
    parent_id: str
    perturbation: str
    category: Category
    expected: Literal["lower", "same", "baseline"]
    task: str
    description: str
    diff: str
    files: dict[str, str] = Field(default_factory=dict)
    guidelines: str | None = None
    language: str
    url: str
    label_source: LabelSource = "perturbation"


class Pair(BaseModel):
    id: str
    a: str
    b: str
    expected_winner: Literal["a", "b", "tie"]
    category: Category
    label_source: LabelSource = "perturbation"


class Rating(BaseModel):
    item_id: str
    judge_id: str
    scores: dict[str, int]
    reasons: dict[str, str] = Field(default_factory=dict)
    merge: bool
    raw: str = ""
    cost_usd: float = 0.0
    latency_s: float = 0.0
    meta: dict = Field(default_factory=dict)

    @property
    def overall(self) -> int:
        return self.scores["R7"]


class Pref(BaseModel):
    pair_id: str
    judge_id: str
    order: Literal["ab", "ba"]
    winner: Literal["a", "b", "tie"]
    reasons: str = ""
    cost_usd: float = 0.0
    latency_s: float = 0.0
    meta: dict = Field(default_factory=dict)


M = TypeVar("M", bound=BaseModel)


def read_jsonl(path: Path, model: type[M]) -> list[M]:
    if not path.exists():
        return []
    with path.open() as f:
        return [model.model_validate_json(line) for line in f if line.strip()]


def write_jsonl(path: Path, rows: Iterable[BaseModel]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w") as f:
        for r in rows:
            f.write(r.model_dump_json() + "\n")
            n += 1
    return n


def append_jsonl(path: Path, row: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(row.model_dump_json() + "\n")


def dump_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str))
