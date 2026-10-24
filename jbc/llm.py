"""Provider-agnostic chat client with an on-disk sqlite cache."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path

CACHE_PATH = Path(os.environ.get("JBC_CACHE", "cache/llm.sqlite"))
_lock = threading.Lock()


@dataclass
class LLMResponse:
    text: str
    input_tokens: int
    output_tokens: int
    latency_s: float
    cached: bool


def _conn() -> sqlite3.Connection:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(CACHE_PATH, check_same_thread=False, timeout=60)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT)")
    return c


def cache_key(provider: str, model: str, system: str, user: str, params: dict) -> str:
    blob = json.dumps([provider, model, system, user, params], sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def _call_anthropic(model: str, system: str, user: str, max_tokens: int, temperature: float):
    import anthropic

    client = anthropic.Anthropic()
    r = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    text = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
    return text, r.usage.input_tokens, r.usage.output_tokens


def _call_openai(model: str, system: str, user: str, max_tokens: int, temperature: float):
    import openai

    client = openai.OpenAI(base_url=os.environ.get("OPENAI_BASE_URL") or None)
    kwargs = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "max_completion_tokens": max_tokens,
    }
    if temperature is not None:
        kwargs["temperature"] = temperature
    kwargs["reasoning_effort"] = os.environ.get("JBC_REASONING_EFFORT", "low")
    for _ in range(3):
        try:
            r = client.chat.completions.create(**kwargs)
            break
        except openai.BadRequestError as e:
            bad = next((k for k in ("temperature", "reasoning_effort") if k in str(e) and k in kwargs), None)
            if not bad:
                raise
            kwargs.pop(bad)
    return r.choices[0].message.content or "", r.usage.prompt_tokens, r.usage.completion_tokens


PROVIDERS = {"anthropic": _call_anthropic, "openai": _call_openai}


def chat(
    provider: str,
    model: str,
    system: str,
    user: str,
    max_tokens: int = 2000,
    temperature: float = 0.0,
    retries: int = 4,
) -> LLMResponse:
    params = {"max_tokens": max_tokens, "temperature": temperature}
    key = cache_key(provider, model, system, user, params)
    with _lock:
        row = _conn().execute("SELECT v FROM cache WHERE k=?", (key,)).fetchone()
    if row:
        d = json.loads(row[0])
        return LLMResponse(d["text"], d["in"], d["out"], d["latency"], cached=True)

    fn = PROVIDERS[provider]
    delay = 2.0
    for attempt in range(retries + 1):
        try:
            t0 = time.time()
            text, tin, tout = fn(model, system, user, max_tokens, temperature)
            latency = time.time() - t0
            break
        except Exception:
            if attempt == retries:
                raise
            time.sleep(delay)
            delay *= 2
    with _lock:
        c = _conn()
        c.execute(
            "INSERT OR REPLACE INTO cache VALUES (?, ?)",
            (key, json.dumps({"text": text, "in": tin, "out": tout, "latency": latency})),
        )
        c.commit()
    return LLMResponse(text, tin, tout, latency, cached=False)


def approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)
