import { useMemo, useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, LabelList } from "recharts";
import { AXIS_LABELS, fmtMetric, metricGood, useData } from "../data";
import type { Scorecard } from "../types";

export default function Leaderboard() {
  const sc = useData<Scorecard>("scorecard.json");
  const [sortKey, setSortKey] = useState<string>("composite");

  const rows = useMemo(() => {
    if (!sc?.judges) return [];
    const r = Object.entries(sc.judges).map(([id, j]) => ({ id, ...j }));
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
  const scatter = rows
    .filter((r) => r.metrics.hack_catch_rate)
    .map((r) => ({ id: r.id, cost: r.cost_per_rating_usd * 1000, hack: r.metrics.hack_catch_rate!.value * 100 }));

  return (
    <div>
      <section className="hero">
        <h1>Can AI code reviewers be fooled?</h1>
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
        are the mean change in overall score (1–5), and 0 is ideal. Composite is the unweighted mean of the
        normalized axes and is only for convenience.
      </p>

      <h2>Cost vs. reward-hack catch rate</h2>
      <div className="chart">
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 20, right: 40, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
            <XAxis type="number" dataKey="cost" name="$/1k ratings" label={{ value: "$ per 1k ratings", position: "bottom", fill: "var(--muted)" }} stroke="var(--muted)" />
            <YAxis type="number" dataKey="hack" name="hack catch %" domain={[0, 100]} label={{ value: "hack catch %", angle: -90, position: "insideLeft", fill: "var(--muted)" }} stroke="var(--muted)" />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} />
            <Scatter data={scatter} fill="var(--accent)">
              <LabelList dataKey="id" position="top" style={{ fontSize: 11, fill: "var(--fg)" }} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
