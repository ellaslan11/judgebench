from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from jbc.config import RESULTS
from jbc.judges.base import Judge
from jbc.schemas import Item, Pair, Pref, Rating, append_jsonl, read_jsonl


def ratings_path(judge_id: str):
    return RESULTS / judge_id / "ratings.jsonl"


def prefs_path(judge_id: str):
    return RESULTS / judge_id / "prefs.jsonl"


def run_judge(judge: Judge, items: list[Item], pairs: list[Pair], workers: int = 8,
              do_rate: bool = True, do_compare: bool = True, log=print) -> dict:
    by_id = {i.id: i for i in items}
    stats = {"rated": 0, "compared": 0, "errors": 0}

    def _run(tasks, path, done_keys, fn, key_of):
        todo = [t for t in tasks if key_of(t) not in done_keys]
        with ThreadPoolExecutor(workers) as ex:
            futs = {ex.submit(fn, t): t for t in todo}
            for f in as_completed(futs):
                try:
                    append_jsonl(path, f.result())
                    yield True
                except Exception as e:  # noqa: BLE001
                    log(f"  ! {judge.id} {key_of(futs[f])}: {type(e).__name__}: {str(e)[:160]}")
                    yield False

    if do_rate:
        done = {r.item_id for r in read_jsonl(ratings_path(judge.id), Rating)}
        for ok in _run(items, ratings_path(judge.id), done, judge.rate, lambda i: i.id):
            stats["rated" if ok else "errors"] += 1
    if do_compare:
        done = {(p.pair_id, p.order) for p in read_jsonl(prefs_path(judge.id), Pref)}
        tasks = [(p, o) for p in pairs for o in ("ab", "ba") if p.a in by_id and p.b in by_id]

        def cmp(t):
            p, o = t
            a, b = by_id[p.a], by_id[p.b]
            return judge.compare(p, a, b, o) if o == "ab" else judge.compare(p, b, a, o)

        for ok in _run(tasks, prefs_path(judge.id), done, cmp, lambda t: (t[0].id, t[1])):
            stats["compared" if ok else "errors"] += 1
    return stats
