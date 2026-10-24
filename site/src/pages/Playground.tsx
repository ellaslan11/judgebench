import { useEffect, useMemo, useState } from "react";
import Diff from "../Diff";
import { EXPECTED_TEXT, PERTURBATION_LABELS, useData } from "../data";
import type { PlaygroundPR } from "../types";

export default function Playground() {
  const prs = useData<PlaygroundPR[]>("playground.json");
  const showcase = useMemo(() => (prs ?? []).filter((p) => p.showcase), [prs]);
  const [pid, setPid] = useState<string>("");
  const [pert, setPert] = useState<string>("delete_tests");

  useEffect(() => {
    const fromHash = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const want = fromHash.get("pr");
    if (want && prs?.some((p) => p.parent_id === want)) {
      setPid(want);
      if (fromHash.get("p")) setPert(fromHash.get("p")!);
    } else if (!pid && showcase.length) setPid(showcase[0].parent_id);
  }, [prs, showcase]); // eslint-disable-line react-hooks/exhaustive-deps

  const pr = prs?.find((p) => p.parent_id === pid);
  if (!prs) return <p className="muted">Loading…</p>;
  if (!pr) return <p className="muted">No playground data. Run <code>jbc export</code>.</p>;

  const base = pr.variants.find((v) => v.perturbation === "none")!;
  const available = pr.variants.filter((v) => v.perturbation !== "none");
  const variant = available.find((v) => v.perturbation === pert) ?? available[0];
  const judges = Object.keys(base.ratings).sort();
  const list = prs.filter((p) => p.showcase || p.parent_id === pid);

  return (
    <div>
      <section className="hero">
        <h1>Fool the judge</h1>
        <p>
          Pick a real merged PR, apply a perturbation, and see how each judge's overall score (1–5) changes.
          Each variant comes with an expected result, e.g. deleting tests should lower the score.
        </p>
      </section>

      <div className="controls">
        <label>
          PR&nbsp;
          <select value={pid} onChange={(e) => setPid(e.target.value)}>
            {list.map((p) => (
              <option key={p.parent_id} value={p.parent_id}>
                {p.parent_id} ({p.language})
              </option>
            ))}
          </select>
        </label>
        <a href={pr.url} target="_blank" rel="noreferrer" className="small">
          view on GitHub ↗
        </a>
      </div>

      <div className="toggles">
        {available.map((v) => (
          <button key={v.perturbation} className={`toggle ${v.perturbation === variant.perturbation ? "on" : ""} cat-${v.category}`}
                  onClick={() => setPert(v.perturbation)}>
            {PERTURBATION_LABELS[v.perturbation] ?? v.perturbation}
          </button>
        ))}
      </div>
      <p className="expect">
        <b>{PERTURBATION_LABELS[variant.perturbation]}</b>: a good judge {EXPECTED_TEXT[variant.expected]}.
      </p>

      <div className="cards">
        {judges.map((j) => {
          const b = base.ratings[j];
          const r = variant.ratings[j];
          if (!b || !r) return null;
          const d = r.r7 - b.r7;
          const ok = variant.expected === "lower" ? d < 0 : d === 0;
          const fooled = variant.expected === "lower" ? d >= 0 : d > 0;
          return (
            <div key={j} className={`card ${ok ? "ok" : fooled ? "fooled" : "meh"}`}>
              <div className="card-head">
                <span className="judge">{j}</span>
                <span className="verdict">{ok ? "✓ correct" : fooled ? "✗ fooled" : "~ over-reacted"}</span>
              </div>
              <div className="score">
                {b.r7} → <b>{r.r7}</b> <span className="delta">({d >= 0 ? "+" : ""}{d})</span>
              </div>
              <p className="reason">{r.reason}</p>
            </div>
          );
        })}
      </div>

      <details className="task">
        <summary>Task</summary>
        <pre className="wrap">{pr.task}</pre>
      </details>
      {variant.perturbation === "polish_desc" && (
        <details className="task" open>
          <summary>Description shown to the judge</summary>
          <pre className="wrap">{variant.description}</pre>
        </details>
      )}
      <div className="diffs">
        <div>
          <h3>Original diff</h3>
          <Diff text={base.diff} />
        </div>
        <div>
          <h3>{PERTURBATION_LABELS[variant.perturbation]} diff</h3>
          <Diff text={variant.diff} />
        </div>
      </div>
    </div>
  );
}
