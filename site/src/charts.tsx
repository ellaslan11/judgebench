import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { JudgeCard } from "./types";

export const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#4b5563", "#ca8a04"];
export type Entry = readonly [string, JudgeCard];
const pctTick = (v: number) => `${Math.round(v * 100)}%`;

export function GoodhartChart({ judges, height = 340 }: { judges: Entry[]; height?: number }) {
  const levels = ["best_of_1", "best_of_2", "best_of_4", "best_of_8", "best_of_all", "pool_plus_attack_r1", "pool_plus_attack_r2", "pool_plus_attack_r3"];
  const label: Record<string, string> = { best_of_1: "N=1", best_of_2: "N=2", best_of_4: "N=4", best_of_8: "N=8", best_of_all: "all", pool_plus_attack_r1: "+attack r1", pool_plus_attack_r2: "+attack r2", pool_plus_attack_r3: "+attack r3" };
  const data = levels.map((l) => {
    const row: Record<string, number | string> = { level: label[l] };
    for (const [id, j] of judges) { row[id] = j.goodhart?.[l]?.pass?.value ?? NaN; row[`${id} score`] = j.goodhart?.[l]?.score?.value ?? NaN; }
    return row;
  });
  return (
    <div className="chart" style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
          <XAxis dataKey="level" stroke="var(--muted)" />
          <YAxis yAxisId="p" domain={[0, 1]} tickFormatter={pctTick} stroke="var(--muted)" label={{ value: "pass rate of pick", angle: -90, position: "insideLeft", fill: "var(--muted)" }} />
          <YAxis yAxisId="s" orientation="right" domain={[1, 5]} stroke="var(--muted)" label={{ value: "judge score of pick", angle: 90, position: "insideRight", fill: "var(--muted)" }} />
          <Tooltip formatter={(v, name) => (String(name).endsWith(" score") ? Number(v).toFixed(2) : pctTick(Number(v)))} />
          <Legend />
          {judges.map(([id], i) => <Line key={id} yAxisId="p" dataKey={id} stroke={COLORS[i % COLORS.length]} dot isAnimationActive={false} />)}
          {judges.map(([id], i) => <Line key={`${id}s`} yAxisId="s" dataKey={`${id} score`} stroke={COLORS[i % COLORS.length]} strokeDasharray="4 4" dot={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BestOfNChart({ judges, height = 340 }: { judges: Entry[]; height?: number }) {
  if (!judges.length) return null;
  const ns = Object.keys(judges[0][1].best_of_n ?? {}).sort((a, b) => +a - +b);
  const data = ns.map((n) => {
    const row: Record<string, number | string> = { n };
    for (const [id, j] of judges) row[id] = j.best_of_n?.[n]?.judge?.value ?? NaN;
    row.random = judges[0][1].best_of_n?.[n]?.random?.value ?? NaN;
    row.oracle = judges[0][1].best_of_n?.[n]?.oracle?.value ?? NaN;
    return row;
  });
  return (
    <div className="chart" style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
          <XAxis dataKey="n" stroke="var(--muted)" label={{ value: "N candidates", position: "insideBottom", offset: -4, fill: "var(--muted)" }} />
          <YAxis domain={[0.4, 1]} tickFormatter={pctTick} stroke="var(--muted)" />
          <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
          <Legend />
          <Line dataKey="oracle" stroke="var(--fg)" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
          <Line dataKey="random" stroke="var(--muted)" strokeDasharray="4 4" dot={false} isAnimationActive={false} />
          {judges.map(([id], i) => <Line key={id} dataKey={id} stroke={COLORS[i % COLORS.length]} dot={false} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AttackChart({ judges, height = 300 }: { judges: Entry[]; height?: number }) {
  const data = judges.map(([id, j]) => ({
    id: id.replace("rubric-", "rubric · ").replace("rubricx-", "rubric+exec · "),
    before: j.metrics.attack_gate_before?.value ?? 0,
    after: j.metrics.attack_gate_rate?.value ?? 0,
  }));
  return (
    <div className="chart" style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
          <XAxis dataKey="id" stroke="var(--muted)" />
          <YAxis domain={[0, 1]} tickFormatter={pctTick} stroke="var(--muted)" />
          <Tooltip formatter={(v) => pctTick(Number(v))} />
          <Legend />
          <Bar dataKey="before" name='failing patches rated "would merge", before attack' fill="var(--muted)" isAnimationActive={false} />
          <Bar dataKey="after" name="after 3 rounds of description + test-file attack" fill="var(--bad)" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
