from __future__ import annotations

from abc import ABC, abstractmethod

from jbc.schemas import Item, Pair, Pref, Rating


class Judge(ABC):
    id: str

    @abstractmethod
    def rate(self, item: Item, sample: int = 0) -> Rating:
        """`sample` > 0 requests an independent re-grade (separate cache entry)."""

    @abstractmethod
    def compare(self, pair: Pair, first: Item, second: Item, order: str) -> Pref:
        """`first` is shown as candidate A. Return winner in terms of the pair's a/b labels."""

    def estimate_tokens(self, item: Item) -> tuple[int, int]:
        return 0, 0


def build_judges(cfg: dict, only: list[str] | None = None) -> list[Judge]:
    from jbc.judges.heuristic import HeuristicJudge
    from jbc.judges.llm_judge import LLMJudge

    out: list[Judge] = []
    for j in cfg["judges"]:
        if only and j["id"] not in only:
            continue
        if j["kind"] == "heuristic":
            out.append(HeuristicJudge(j["id"]))
        else:
            if not j.get("model"):
                continue
            out.append(LLMJudge(**j))
    return out
