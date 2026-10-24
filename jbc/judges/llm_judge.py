from __future__ import annotations

import hashlib
import json
import re

from jbc import llm
from jbc.config import CONFIGS, load_yaml
from jbc.judges import prompts
from jbc.judges.base import Judge
from jbc.judges.heuristic import _to_label
from jbc.schemas import Item, Pair, Pref, Rating


def parse_json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    raise ValueError(f"no JSON in judge output: {text[:200]!r}")


def _clamp(v) -> int:
    return max(1, min(5, round(float(v))))


class LLMJudge(Judge):
    def __init__(self, id: str, kind: str, provider: str, model: str,
                 price_in: float = 0.0, price_out: float = 0.0, max_tokens: int = 4000, **_):
        self.id, self.kind, self.provider, self.model = id, kind, provider, model
        self.price_in, self.price_out, self.max_tokens = price_in, price_out, max_tokens
        if kind == "rubric":
            self.system = prompts.rubric_system(load_yaml(CONFIGS / "rubric_v1.yaml"))
            self.max_tokens = max(max_tokens, 6000)
        elif kind == "zero_shot":
            self.system = prompts.ZS_SYSTEM
        else:
            raise ValueError(kind)
        self.prompt_sha = hashlib.sha256(self.system.encode()).hexdigest()[:12]

    def _cost(self, r: llm.LLMResponse) -> float:
        return (r.input_tokens * self.price_in + r.output_tokens * self.price_out) / 1e6

    def _meta(self, r: llm.LLMResponse) -> dict:
        return {"model": self.model, "prompt_sha": self.prompt_sha, "kind": self.kind,
                "in_tok": r.input_tokens, "out_tok": r.output_tokens, "cached": r.cached}

    def rate(self, item: Item) -> Rating:
        r = llm.chat(self.provider, self.model, self.system, prompts.single_user(item), self.max_tokens)
        d = parse_json(r.text)
        if self.kind == "rubric":
            scores = {k: _clamp(v) for k, v in d["scores"].items()}
            reasons = {k: str(v) for k, v in d.get("reasons", {}).items()}
        else:
            scores = {"R7": _clamp(d["score"])}
            reasons = {"R7": str(d.get("reason", ""))}
        return Rating(item_id=item.id, judge_id=self.id, scores=scores, reasons=reasons,
                      merge=scores["R7"] >= 4, raw=r.text, cost_usd=self._cost(r),
                      latency_s=r.latency_s, meta=self._meta(r))

    def compare(self, pair: Pair, first: Item, second: Item, order: str) -> Pref:
        r = llm.chat(self.provider, self.model, prompts.PAIR_SYSTEM, prompts.pair_user(first, second), 800)
        d = parse_json(r.text)
        w = str(d.get("winner", "tie")).strip()
        w = "A" if w.upper() == "A" else "B" if w.upper() == "B" else "tie"
        return Pref(pair_id=pair.id, judge_id=self.id, order=order, winner=_to_label(w, order),
                    reasons=str(d.get("reason", "")), cost_usd=self._cost(r),
                    latency_s=r.latency_s, meta=self._meta(r))

    def estimate_tokens(self, item: Item) -> tuple[int, int]:
        return llm.approx_tokens(self.system + prompts.single_user(item)), (
            600 if self.kind == "rubric" else 150)
