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

_BAD_ESCAPE = re.compile(r'\\(?!["\\/bfnrtu])')


def parse_json(text: str, require: str | None = None) -> dict:
    try:
        return _parse_json(text, require)
    except ValueError:
        fixed = _BAD_ESCAPE.sub(r"\\\\", text)
        if fixed != text:
            try:
                return _parse_json(fixed, require)
            except ValueError:
                pass
        # Zero-shot output with unescaped quotes in "reason": salvage the score field alone.
        m = re.search(r'"score"\s*:\s*"?:?\s*([1-5](?:\.\d+)?)', text)
        if require == "score" and m:
            return {"score": m.group(1), "reason": "(unparseable JSON; score recovered by regex)"}
        raise


def _parse_json(text: str, require: str | None = None) -> dict:
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        d = json.loads(text)
        if isinstance(d, dict) and (require is None or require in d):
            return d
    except json.JSONDecodeError:
        pass
    found = []
    dec = json.JSONDecoder()
    for m in re.finditer(r"\{", text):
        try:
            d = dec.raw_decode(text[m.start():])[0]
        except json.JSONDecodeError:
            continue
        if isinstance(d, dict):
            if require is None or require in d:
                return d
            found.append(d)
    if found and require is None:
        return found[0]
    raise ValueError(f"no JSON in judge output: {text[:200]!r}")


def _clamp(v) -> int:
    if isinstance(v, str):
        m = re.search(r"\d+(?:\.\d+)?", v)
        if not m:
            raise ValueError(f"no number in score {v!r}")
        v = m.group(0)
    return max(1, min(5, round(float(v))))


class LLMJudge(Judge):
    def __init__(self, id: str, kind: str, provider: str, model: str,
                 price_in: float = 0.0, price_out: float = 0.0, max_tokens: int = 4000,
                 rubric: str = "rubric_v1.yaml", bias_warning: bool = True, **_):
        self.id, self.kind, self.provider, self.model = id, kind, provider, model
        self.price_in, self.price_out, self.max_tokens = price_in, price_out, max_tokens
        if kind == "rubric":
            self.system = prompts.rubric_system(load_yaml(CONFIGS / rubric), warn=bias_warning)
            self.max_tokens = max(max_tokens, 6000)
        elif kind == "zero_shot":
            self.system = prompts.ZS_SYSTEM if bias_warning else prompts.ZS_SYSTEM.replace(prompts.ZS_WARNING, "")
        else:
            raise ValueError(kind)
        self.prompt_sha = hashlib.sha256(self.system.encode()).hexdigest()[:12]

    def _cost(self, r: llm.LLMResponse) -> float:
        return (r.input_tokens * self.price_in + r.output_tokens * self.price_out) / 1e6

    def _meta(self, r: llm.LLMResponse) -> dict:
        return {"model": self.model, "prompt_sha": self.prompt_sha, "kind": self.kind,
                "in_tok": r.input_tokens, "out_tok": r.output_tokens, "cached": r.cached}

    def rate(self, item: Item, sample: int = 0) -> Rating:
        r = llm.chat(self.provider, self.model, self.system, prompts.single_user(item), self.max_tokens,
                     sample=sample)
        d = parse_json(r.text, "scores" if self.kind == "rubric" else "score")
        if self.kind == "rubric":
            scores = {k: _clamp(v) for k, v in d["scores"].items()}
            reasons = {k: str(v) for k, v in d.get("reasons", {}).items()}
        else:
            scores = {"R7": _clamp(d["score"])}
            reasons = {"R7": str(d.get("reason", ""))}
        return Rating(item_id=item.id, judge_id=self.id, scores=scores, reasons=reasons,
                      merge=scores["R7"] >= 4, raw=r.text, cost_usd=self._cost(r),
                      latency_s=r.latency_s, meta={**self._meta(r), "sample": sample})

    def compare(self, pair: Pair, first: Item, second: Item, order: str) -> Pref:
        r = llm.chat(self.provider, self.model, prompts.PAIR_SYSTEM, prompts.pair_user(first, second), 800)
        d = parse_json(r.text, "winner")
        w = str(d.get("winner", "tie")).strip()
        w = "A" if w.upper() == "A" else "B" if w.upper() == "B" else "tie"
        return Pref(pair_id=pair.id, judge_id=self.id, order=order, winner=_to_label(w, order),
                    reasons=str(d.get("reason", "")), cost_usd=self._cost(r),
                    latency_s=r.latency_s, meta=self._meta(r))

    def estimate_tokens(self, item: Item) -> tuple[int, int]:
        return llm.approx_tokens(self.system + prompts.single_user(item)), (
            600 if self.kind == "rubric" else 150)
