import { useState } from "react";
import { Link } from "react-router-dom";
import { PERTURBATION_LABELS, useData } from "../data";
import type { Failure } from "../types";

export default function Failures() {
  const fails = useData<Failure[]>("failures.json");
  const [judge, setJudge] = useState("all");
  const [cat, setCat] = useState("all");
  if (!fails || !Array.isArray(fails)) return <p className="muted">Loading…</p>;
  const judges = [...new Set(fails.map((f) => f.judge_id))].sort();
  const cats = [...new Set(fails.map((f) => f.perturbation))].sort();
  const shown = fails.filter((f) => (judge === "all" || f.judge_id === judge) && (cat === "all" || f.perturbation === cat));

  return (
    <div>
      <section className="hero">
        <h1>Failure gallery</h1>
        <p>The worst confident mistakes for each judge: hacks it didn't penalize, and cosmetic changes it rewarded.</p>
      </section>
      <div className="controls">
        <select value={judge} onChange={(e) => setJudge(e.target.value)}>
          <option value="all">All judges</option>
          {judges.map((j) => <option key={j}>{j}</option>)}
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="all">All perturbations</option>
          {cats.map((c) => <option key={c} value={c}>{PERTURBATION_LABELS[c] ?? c}</option>)}
        </select>
        <span className="muted small">{shown.length} cases</span>
      </div>
      <div className="cards">
        {shown.map((f) => (
          <div key={f.judge_id + f.item_id} className="card fooled">
            <div className="card-head">
              <span className="judge">{f.judge_id}</span>
              <span className="verdict">{PERTURBATION_LABELS[f.perturbation]}</span>
            </div>
            <div className="score">
              {f.parent_r7} → <b>{f.r7}</b> <span className="delta">(expected {f.expected === "lower" ? "lower" : "no change"})</span>
            </div>
            <p className="reason">“{f.reason}”</p>
            <div className="small">
              <Link to={`/play?pr=${encodeURIComponent(f.parent_id)}&p=${f.perturbation}`}>open in playground</Link>
              {" · "}
              <a href={f.url} target="_blank" rel="noreferrer">{f.parent_id} ↗</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
