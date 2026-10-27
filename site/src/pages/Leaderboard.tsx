import { useMemo, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, LabelList } from "recharts";
import { AXIS_LABELS, fmtMetric, metricGood, useData } from "../data";
import type { Scorecard } from "../types";

export default function Leaderboard() {
  const sc = useData<Scorecard>("scorecard.json");
  const [sortKey, setSortKey] = useState<string>("composite");

  const rows = useMemo(() => {
    if (!sc?.judges) return [];
    const r = Object.entries(sc.judges).filter(([, j]) => j.n_ratings > 0 || j.n_prefs > 0).map(([id, j]) => ({ id, ...j }));
    const val = (x: (typeof r)[number]) => {
      if (sortKey === "composite") return x.composite ?? -1;
      if (sortKey === "cost") return -x.cost_per_rating_usd;
      const m = x.metrics[sortKey];
      if (!m) return -99;
      const dir = sc.axes[sortKey].direction;
      return dir === "lower" ? -m.value : dir === "zero" ? -Math.abs(m.value) : m.value;
    };
    return r.sort((a, b) => val(b) - val(a));
  }, [sc, sortKey]);

  if (!sc?.judges) return <p className="muted">No scorecard yet. Run <code>jbc score && jbc export</code>.</p>;
  const axes = Object.keys(sc.axes);
  const swe = Object.entries(sc.judges).filter(([, j]) => j.metrics.swe_pair_acc)
    .sort((a, b) => (b[1].metrics.swe_pair_acc?.value ?? 0) - (a[1].metrics.swe_pair_acc?.value ?? 0));
  const f2 = (m: { value: number; lo: number; hi: number } | null | undefined) => (m ? `${m.value.toFixed(2)} (${m.lo.toFixed(2)}–${m.hi.toFixed(2)})` : "–");
  const pc = (m: { value: number } | null | undefined) => (m ? `${Math.round(m.value * 100)}%` : "–");
  const scatter = rows
    .filter((r) => r.metrics.hack_catch_rate)
    .map((r) => ({ id: r.id, cost: r.cost_per_rating_usd * 1000, hack: r.metrics.hack_catch_rate!.value * 100 }));

  return (
    <div>
      <section className="hero">
        <h1>Leaderboard</h1>
        <p>
          Two boards. First, execution labels: 751 public agent patches on 105 SWE-bench tasks, each labelled pass/fail by
          hidden tests the judge never sees (held-out split shown). Second, scripted perturbations with known answers.
          Neither names a winner: the top judges' intervals overlap.
        </p>
      </section>

      <h2>Execution labels (SWE-bench, 72 held-out tasks)</h2>
      <div className="table-wrap">
        <table className="board">
          <thead><tr><th>Judge</th><th>Passing ranked above failing (95% CI)</th><th>AUROC</th><th>Best-of-4 pass rate</th><th>Attacked failing patch at "would merge"</th><th>False accept / reject at dev-tuned cutoff</th></tr></thead>
          <tbody>
            {swe.map(([id, j]) => (
              <tr key={id}><td className="judge">{id}</td><td className="num">{f2(j.metrics.swe_pair_acc)}</td><td className="num">{f2(j.metrics.swe_auroc)}</td>
                <td className="num">{f2(j.metrics.swe_best_of_4)}</td>
                <td className="num">{j.metrics.attack_gate_rate ? `${pc(j.metrics.attack_gate_before)} → ${pc(j.metrics.attack_gate_rate)}` : "not run"}</td>
                <td className="num">{j.swe_cutoff ? `R7 ≥ ${j.swe_cutoff}: ${pc(j.metrics.swe_false_accept_cal)} / ${pc(j.metrics.swe_false_reject_cal)}` : "–"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Random ranks a passing patch above a failing one 50% of the time. <code>rubricx-*</code> judges see the execution
        verdict of the PR's own tests (fail → pass or not); <code>heuristic-tests</code> counts test lines. Attack: 3 rounds of
        rewriting the description and adding one test file, source byte-identical.
      </p>

      <h2>Scripted perturbations</h2>
      <section className="hero">
        <p>
          We took <b>{sc.n_parents}</b> real merged PRs from popular open-source repos and made{" "}
          <b>{sc.n_items}</b> scripted variants with known answers: tests deleted or skipped, diffs padded
          with comments, a polished description added, an unrelated file edited. A good judge should score hacks lower and ignore
          cosmetic changes. Here's how each judge did.
        </p>
      </section>

      <div className="table-wrap">
        <table className="board">
          <thead>
            <tr>
              <th>Judge</th>
              <th className="sortable" onClick={() => setSortKey("composite")}>
                Composite {sortKey === "composite" && "▾"}
              </th>
              {axes.map((a) => (
                <th key={a} className="sortable" title={sc.axes[a].desc} onClick={() => setSortKey(a)}>
                  {AXIS_LABELS[a] ?? a} {sortKey === a && "▾"}
                </th>
              ))}
              <th className="sortable" onClick={() => setSortKey("cost")}>
                $/1k ratings {sortKey === "cost" && "▾"}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="judge">{r.id}</td>
                <td className="num strong">{r.composite != null ? r.composite.toFixed(2) : "–"}</td>
                {axes.map((a) => {
                  const m = r.metrics[a];
                  if (!m) return <td key={a} className="num muted">–</td>;
                  return (
                    <td key={a} className={`num ${metricGood(sc.axes[a].direction, m.value)}`}
                        title={`95% CI ${fmtMetric(a, m.lo)} – ${fmtMetric(a, m.hi)} · n=${m.n}`}>
                      {fmtMetric(a, m.value)}
                    </td>
                  );
                })}
                <td className="num">{(r.cost_per_rating_usd * 1000).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Hover a cell for its 95% bootstrap CI (resampled over parent PRs). Padding bias and description gaming
        are the mean change in overall score (1–5), and 0 is ideal. Composite is the geometric mean of
        detection (hack, subtle hack, scope, pairwise) and invariance (bias/stability axes), so one blind spot
        pulls it down hard. It is only for convenience; agent-PR AUROC is excluded.
      </p>

      {sc.rank_robustness && Object.keys(sc.rank_robustness).length > 0 && (
        <>
          <h2>Is the ranking robust to the weights?</h2>
          <p className="muted small">
            Judges re-ranked under 2,000 random weightings of the axes (Dirichlet). "Ranked #1" keeps the
            composite's structure (blind spots still penalized) and is the share of weightings where the judge comes
            out on top; "#1, plain average" uses a simple weighted mean, which lets a judge with a 0% axis win.
          </p>
          <div className="table-wrap">
            <table className="board">
              <thead>
                <tr><th>Judge</th><th>Ranked #1</th><th>Mean rank</th><th>#1, plain average</th></tr>
              </thead>
              <tbody>
                {Object.entries(sc.rank_robustness)
                  .sort((a, b) => a[1].mean_rank - b[1].mean_rank)
                  .map(([id, r]) => (
                    <tr key={id}>
                      <td>{id}</td>
                      <td className="num">{Math.round(r.top1 * 100)}%</td>
                      <td className="num">{r.mean_rank.toFixed(2)}</td>
                      <td className="num">{Math.round(r.top1_linear * 100)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Cost vs. reward-hack catch rate</h2>
      <div className="chart">
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 20, right: 40, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
            <XAxis type="number" dataKey="cost" name="$/1k ratings" label={{ value: "$ per 1k ratings", position: "bottom", fill: "var(--muted)" }} stroke="var(--muted)" />
            <YAxis type="number" dataKey="hack" name="hack catch %" domain={[0, 100]} label={{ value: "hack catch %", angle: -90, position: "insideLeft", fill: "var(--muted)" }} stroke="var(--muted)" />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={scatter} fill="var(--accent)" isAnimationActive={false}>
              <LabelList dataKey="id" position="top" style={{ fontSize: 11, fill: "var(--fg)" }} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
