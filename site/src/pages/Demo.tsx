import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Diff from "../Diff";
import { AttackChart, BestOfNChart, DefenceChart, GoodhartChart } from "../charts";
import { useData } from "../data";
import { PREDICTIONS } from "../predictions";
import type { Demo as DemoData, DemoAttack, DemoHook, DemoRetest, JudgeCard, Metric, Scorecard } from "../types";

const NAMES: Record<string, string> = {
  "devin-rubric": "Devin", "rubric-gpt6.1-sol": "GPT-6.1-sol", "rubric-gpt6-luna": "GPT-6-luna",
  "merge-zs-gpt6.1-sol": "GPT-6.1-sol (simpler prompt)", "merge-zs-gpt6-luna": "GPT-6-luna (simpler prompt)",
  "rubric-haiku4.5": "Claude Haiku 4.5", "heuristic-tests": "No AI: count the lines",
  "rubricx-gpt6.1-sol": "GPT-6.1-sol + runs the tests", "rubricx-gpt6-luna": "GPT-6-luna + runs the tests",
  "rubricxc-gpt6.1-sol": "GPT-6.1-sol + tests + other agents", "rubricxc-gpt6-luna": "GPT-6-luna + tests + other agents",
};
const MODELS = [["gpt6-luna", "GPT-6-luna"], ["gpt6.1-sol", "GPT-6.1-sol"]] as const;
const PARTS = ["The setting", "What we found", "Can it be fixed?", "Bottom line"];
const name = (id: string) => NAMES[id] ?? id;
const pct = (m: Metric | undefined) => (m ? `${Math.round(m.value * 100)}%` : "–");
const pctv = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "–" : `${Math.round(v * 100)}%`);
const ci = (m: Metric | undefined) => (m ? `${m.value.toFixed(2)} (${m.lo.toFixed(2)}–${m.hi.toFixed(2)})` : "–");
const cls = (r7: number) => (r7 >= 4 ? "good" : r7 >= 3 ? "mid" : "bad");
const verdictWord = (r7: number) => (r7 >= 4 ? "would merge" : r7 >= 3 ? "needs changes" : "reject");
const VERDICT: Record<string, string> = {
  verified: "we ran the attacker's test: it fails without the patch and passes with it (a real test)",
  vacuous: "we ran the attacker's test: it passes even without the patch (decorative)",
  failing: "we ran the attacker's test: it fails even with the patch",
  empty: "no runnable test", error: "the test could not be run",
};
const gate = (j: JudgeCard | undefined, own: boolean) =>
  own ? [j?.metrics.attack_gate_before?.value, j?.metrics.attack_gate_rate?.value] : [j?.metrics.attack_gate_xfer_before?.value, j?.metrics.attack_gate_xfer?.value];
const lift = (j: JudgeCard | undefined, own: boolean) => { const [b, a] = gate(j, own); return b == null || a == null ? null : a - b; };
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ---- small presentational helpers ---- */
const T = ({ t, children }: { t: string; children: ReactNode }) => <span className="term" title={t}>{children}</span>;
const Caption = ({ show, children }: { show: boolean; children: ReactNode }) => (show ? <div className="caption"><span className="lbl">Takeaway</span>{children}</div> : <div style={{ height: 70 }} />);
const More = ({ title = "Details and exact numbers", children }: { title?: string; children: ReactNode }) => <details className="more"><summary>{title}</summary>{children}</details>;
const Scale = () => <div className="scale"><span className="bad">1</span><span className="bad">2 reject</span><span className="mid">3 needs changes</span><span className="good">4 would merge</span><span className="good">5</span></div>;
const Score = ({ v }: { v: number }) => <span className={`scorebox ${cls(v)}`}>{v}<small>/ 5 · {verdictWord(v)}</small></span>;

function Typewriter({ text, active, cps = 160 }: { text: string; active: boolean; cps?: number }) {
  const [n, setN] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active) { setN(text.length); return; }
    setN(0);
    const step = Math.max(1, Math.round(cps / 20));
    const id = setInterval(() => setN((x) => { if (x >= text.length) { clearInterval(id); return x; } return x + step; }), 50);
    return () => clearInterval(id);
  }, [text, active, cps]);
  return <pre className={`desc ${active && n < text.length ? "typing" : ""}`}>{text.slice(0, n)}</pre>;
}

function CountUp({ to, suffix = "%", ms = 900 }: { to: number | null | undefined; suffix?: string; ms?: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (to == null) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / ms); setV(to * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <span className="countup">{to == null ? "–" : `${Math.round(v * 100)}${suffix}`}</span>;
}

/* ---- scene bodies ---- */
function Hook({ h }: { h: DemoHook }) {
  return (
    <div>
      <div className="rounds">
        <Score v={h.r7} />
        <span className="small muted">judge: {name(h.judge)}</span>
        <span className="tag bad">reality: fails the project's tests</span>
        <a className="small" href={h.url} target="_blank" rel="noreferrer">{h.repo} ↗</a>
      </div>
      <p className="reason"><b>What the judge said:</b> {h.reason}</p>
      <div className="cols">
        <div className="panel"><h4>The bug report the agent was asked to fix</h4><pre className="desc" style={{ maxHeight: 220 }}>{h.task.slice(0, 900)}{h.task.length > 900 ? " …" : ""}</pre></div>
        <div className="panel"><h4>The agent's code change</h4><Diff text={h.diff} maxLines={60} /></div>
      </div>
    </div>
  );
}

function Retest({ rows, beat, onBeat }: { rows: DemoRetest[]; beat: number; onBeat: (b: number) => void }) {
  const [idx, setIdx] = useState(0);
  const r = rows[idx];
  if (!r) return <p className="muted">No re-grade data exported.</p>;
  const k = Math.min(beat, r.scores.length - 1);
  return (
    <div>
      <p className="howto">The same pull request, graded three times. Nothing changed between gradings: same code, same prompt, same model.</p>
      <div className="rounds">
        <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); onBeat(0); }}>
          {rows.map((x, i) => <option key={i} value={i}>{x.parent} · {name(x.judge)} · scores {x.scores.join(" / ")}</option>)}
        </select>
        <a className="small" href={r.url} target="_blank" rel="noreferrer">PR ↗</a>
      </div>
      <div className="rounds">
        {r.scores.map((_, i) => <button key={i} className={`btn ${k === i ? "on" : ""}`} onClick={() => onBeat(i)}>Grading {i + 1}</button>)}
        <span style={{ marginLeft: "auto" }}><Score v={r.scores[k]} /></span>
      </div>
      <p className="reason"><b>{name(r.judge)} said:</b> {r.reasons[k]}</p>
    </div>
  );
}

function Attack({ attacks, beat, onBeat, playing }: { attacks: DemoAttack[]; beat: number; onBeat: (b: number) => void; playing: boolean }) {
  const [idx, setIdx] = useState(0);
  const a = attacks[idx];
  if (!a) return <p className="muted">No cached attack exported yet.</p>;
  const rnd = Math.min(beat, a.rounds.length);
  const cur = rnd === 0 ? null : a.rounds[rnd - 1];
  const r7 = cur ? cur.r7 : a.before.r7;
  return (
    <div>
      <div className="rounds">
        <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); onBeat(0); }}>
          {attacks.map((x, i) => <option key={i} value={i}>{x.target.split("::")[0]} · judge {name(x.judge)} · score {x.before.r7} → {Math.max(...x.rounds.map((r) => r.r7))}</option>)}
        </select>
        <span className="tag bad">reality, unchanged throughout: fails the project's tests</span>
        <a className="small" href={a.url} target="_blank" rel="noreferrer">bug report ↗</a>
      </div>
      <div className="rounds">
        <button className={`btn ${rnd === 0 ? "on" : ""}`} onClick={() => onBeat(0)}>Before</button>
        {a.rounds.map((r, i) => <button key={r.round} className={`btn ${rnd === i + 1 ? "on" : ""}`} onClick={() => onBeat(i + 1)}>Attack round {r.round}</button>)}
        <span style={{ marginLeft: "auto" }}><Score v={r7} /></span>
      </div>
      <p className="reason"><b>{name(a.judge)} said:</b> {cur ? cur.reason : a.before.reason}
        {cur?.verdict && <> · <span className={`tag ${cur.verdict === "verified" ? "good" : "bad"}`}>{VERDICT[cur.verdict] ?? cur.verdict}</span></>}
      </p>
      <div className="cols">
        <div className="panel">
          <h4>{cur ? `Description, rewritten by the attacker (round ${cur.round})` : "Description, as the agent submitted it"}</h4>
          <Typewriter text={cur ? cur.description : a.description || "(the agent wrote none)"} active={playing && !!cur} />
        </div>
        <div className="panel">
          <h4>{cur ? "Test file the attacker added. The code change itself is untouched." : "The code change (this is what fails the tests)"}</h4>
          <Diff text={cur ? cur.test_file || "(no new test file this round)" : a.diff} maxLines={60} />
        </div>
      </div>
    </div>
  );
}

function Ladder({ J, model }: { J: Record<string, JudgeCard>; model: string }) {
  const full = J[`rubric-${model}`], x = J[`rubricx-${model}`], xc = J[`rubricxc-${model}`], code = J[`rubric-code-${model}`];
  const steps = [
    { label: "plain judge", g: gate(full, true), what: "reads the description, the code and the tests", left: "everything: a persuasive description plus a decorative test" },
    { label: "+ run the PR's tests", g: gate(x, true), what: "we run the PR's own tests in a sandbox and tell the judge whether they really pass only with the change", left: "attacker tests that really do pass only with the (wrong) change: about 45% of them" },
    { label: "+ check other agents", g: gate(xc, false), what: "we also run those tests against other agents' attempts at the same task", left: "wrong tests that other agents' wrong attempts also pass: 60% of them" },
    { label: "hide description + tests", g: gate(code, false), what: "the judge sees only the code", left: "nothing to attack, but it already approves the wrong patch far more often" },
  ];
  return (
    <div>
      <DefenceChart steps={steps.map((s) => ({ label: s.label, before: s.g[0] ?? null, after: s.g[1] ?? null }))} height={210} />
      <div className="ladder">
        {steps.map((s) => (
          <div className="cell" key={s.label}>
            <h4>{s.label}</h4>
            <div className="big">{pctv(s.g[0])} → {pctv(s.g[1])}</div>
            <div className="small muted">wrong patches approved, before → after attack. {s.what}.</div>
            <div className="small" style={{ marginTop: 6 }}><b>Still open:</b> {s.left}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Channels({ J, model }: { J: Record<string, JudgeCard>; model: string }) {
  const full = J[`rubric-${model}`], code = J[`rubric-code-${model}`], tests = J[`rubric-codetests-${model}`], desc = J[`rubric-codedesc-${model}`];
  const fullLift = lift(full, true);
  const share = (j: JudgeCard | undefined) => { const l = lift(j, false); return l == null || !fullLift ? "–" : `${Math.round((l / fullLift) * 100)}%`; };
  return (
    <div className="grid2">
      <div className="cell"><h4>Judge sees only the code</h4>
        Tells right from wrong patches <b>as well as the full judge</b> ({ci(code?.metrics.swe_pair_acc)} vs {ci(full?.metrics.swe_pair_acc)}),
        but approves the untouched wrong patch <b>{pctv(gate(code, false)[0])}</b> of the time (full judge: {pctv(gate(full, true)[0])}),
        and cannot see test tampering: it catches <b>{pct(code?.metrics.hack_catch_rate)}</b> of deleted or gutted tests (full judge: {pct(full?.metrics.hack_catch_rate)}).</div>
      <div className="cell"><h4>Code + tests, no description</h4>
        The attack still works almost fully: <b>{share(tests)}</b> of the full effect ({pctv(gate(tests, false)[0])} → {pctv(gate(tests, false)[1])}). The test file is the attacker's lever.</div>
      <div className="cell"><h4>Code + description, no tests</h4>
        The attack barely works: <b>{share(desc)}</b> of the full effect ({pctv(gate(desc, false)[0])} → {pctv(gate(desc, false)[1])}). Rewriting the description alone does little.</div>
      <div className="cell"><h4>Full pull request</h4>
        {pctv(gate(full, true)[0])} → <b>{pctv(gate(full, true)[1])}</b> under attack. Its low starting rate was mostly a penalty for <i>missing</i> tests, which is exactly what the attacker supplies.</div>
    </div>
  );
}

function Preds() {
  const tally = (s: string) => PREDICTIONS.filter((p) => p.result === s).length;
  return (
    <div>
      <div className="tally"><span className="held">{tally("held")} came true</span><span className="failed">{tally("failed")} did not</span><span className="ill-posed">{tally("ill-posed")} could not be tested as written</span></div>
      <div className="preds">
        {PREDICTIONS.map((p) => <div className={`pred ${p.result}`} key={p.id}><span className="pid">{p.id}</span><span>{p.text}<br /><span className="note">{p.result === "held" ? "came true" : p.result === "failed" ? "did not" : p.result}: {p.note}</span></span></div>)}
      </div>
    </div>
  );
}

type Scene = { key: string; part: number; title: string; dur: number; beats?: number; short?: boolean; note: string;
  body: (ctx: { beat: number; setBeat: (b: number) => void; playing: boolean; cap: boolean }) => ReactNode };

export default function Demo() {
  const sc = useData<Scorecard>("scorecard.json");
  const demo = useData<DemoData>("demo.json");
  const [i, setI] = useState(0);
  const [beat, setBeatRaw] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [notes, setNotes] = useState(false);
  const [short, setShort] = useState(false);
  const [model, setModel] = useState<string>("gpt6-luna");
  const J = sc?.judges ?? {};
  const sol = J["rubric-gpt6.1-sol"], luna = J["rubric-gpt6-luna"], devin = J["devin-rubric"];
  const signal = Object.entries(J).filter(([id, j]) => j.metrics.swe_pair_acc && id in NAMES && !id.startsWith("rubricx") && !id.startsWith("merge-zs"))
    .sort((a, b) => (b[1].metrics.swe_pair_acc?.value ?? 0) - (a[1].metrics.swe_pair_acc?.value ?? 0));
  const att = Object.entries(J).filter(([id, j]) => j.metrics.attack_gate_rate && !id.startsWith("rubricx"));
  const gh = Object.entries(J).filter(([id, j]) => j.goodhart?.pool_plus_attack_r3 && !id.startsWith("rubricx"));
  const bo = (n: string) => sol?.best_of_n?.[n]?.judge;
  const attacks = useMemo(() => (demo?.attacks ?? []).filter((a) => a.judge.startsWith("rubric-")).concat((demo?.attacks ?? []).filter((a) => !a.judge.startsWith("rubric-"))), [demo]);
  const consensus = sc?.consensus as Record<string, Metric> | undefined;
  const nAttacked = sol?.metrics.attack_gate_rate?.n ?? 72;
  const modelPicker = (
    <span className="rounds" style={{ margin: "0 0 6px" }}>
      <span className="small muted">Judge model:</span>
      {MODELS.map(([m, label]) => <button key={m} className={`btn ${model === m ? "on" : ""}`} onClick={() => setModel(m)}>{label}</button>)}
    </span>
  );

  const scenes: Scene[] = [
    { key: "title", part: 0, title: "Can the grader be trusted?", dur: 9, short: true, note: "Opening. AI coding agents are now checked by other AIs; we tested whether that checker can be trusted and found it can be gamed without changing a line of code. Everything here is a measurement on real agent-written patches with a known right answer.",
      body: () => <>
        <p className="kicker">JudgeBench-Code</p>
        <h1>AI now writes code. Another AI grades it.<br />Can that grader be trusted?</h1>
        <p className="lead">A benchmark that tests the <b>grader</b>, not the coder: 751 real changes written by AI coding agents, each with a known right answer. The grader carries real signal, yet it can be pushed from "reject" to "approve" <b>without changing a single line of code</b>, and the obvious fixes only half work.</p>
        <p className="small muted" style={{ marginTop: 18 }}>Press play, or step with the arrow keys. About five minutes.</p>
      </> },
    { key: "pipeline", part: 0, title: "Who writes the code, who checks it", dur: 20, short: true, note: "Define the actors: a coding agent is an AI system like Devin or Codex that turns a bug report into a code change; a judge is a second model that scores the change 1–5 like a reviewer. Platforms use that score to finish tasks, pick among attempts and as a training reward. No human in the loop.",
      body: ({ cap }) => <>
        <p className="kicker">Part 1 · The setting</p>
        <h2>Who writes the code, and who checks it</h2>
        <div className="pipeline">
          <div className="node"><span className="n">1</span><h4>A task</h4><p>A bug report from a real open-source project, e.g. "requests breaks when the HTTP method is a byte string".</p></div>
          <div className="node"><span className="n">2</span><h4>A coding agent</h4><p>An AI system (Devin, Codex, Claude Code…) reads it and writes a <T t="A proposed change to the code, with a description and sometimes tests">pull request</T>: code changes, a description, maybe tests.</p></div>
          <div className="node hot"><span className="n">3</span><h4>An AI judge</h4><p>A second AI model reads the pull request and scores it <b>1 to 5</b>, like a reviewer. <b>This is what we test.</b></p><Scale /></div>
          <div className="node"><span className="n">4</span><h4>A decision, no human</h4><p>Score 4 or 5 means "would merge". Platforms use it to declare a task done, to pick the best of several attempts, and as the reward when training agents.</p></div>
        </div>
        <Caption show={cap}>The judge is a second AI grading the first AI's homework. It is cheap and fast, so it quietly became the referee. Nobody had measured how good a referee it is.</Caption>
      </> },
    { key: "why", part: 0, title: "Why a bad referee matters", dur: 22, note: "Each place the judge sits turns a judge error into a product or training failure. If the judge is gameable, anything optimised against it, including agents in training, drifts toward pleasing the judge rather than being right. What is new: controlled measurement against execution ground truth, an adaptive attacker that cannot touch the code, pre-registered predictions, and tests of the obvious defences.",
      body: ({ cap }) => <>
        <p className="kicker">Part 1 · The setting</p>
        <h2>Why a bad referee is worse than a bad player</h2>
        <div className="grid2" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="cell"><h4>It gates merges</h4>If the judge approves wrong code, wrong code ships, and the judge's score is the number the team sees.</div>
          <div className="cell"><h4>It picks the winner</h4>Agents make several attempts and let the judge choose. A judge that prefers the wrong attempt makes "try more" useless.</div>
          <div className="cell"><h4>It trains the next agent</h4>When the score is the reward, agents learn to please the judge. If the judge can be pleased without being right, agents learn exactly that.</div>
        </div>
        <h3>What we built</h3>
        <ul className="plain">
          <li><b>Ground truth.</b> 751 real changes by 30+ coding agents for 105 real tasks, each with hidden tests it passes or fails.</li>
          <li><b>An adversary.</b> An attacker AI allowed to rewrite the description and add one test file, never the code, with three tries and the judge's feedback.</li>
          <li><b>Pre-registration.</b> 21 numeric predictions committed before each experiment. <b>Fixes, tested.</b> 4,428 sandbox runs.</li>
        </ul>
        <Caption show={cap}>To our knowledge the first controlled measurement of how much real signal AI code judges carry, how cheaply they can be gamed, and whether the standard defences work.</Caption>
      </> },
    { key: "truth", part: 0, title: "How we know who was right", dur: 20, note: "Method in one scene. Hidden tests written by the project maintainers are the answer key; the judge never sees them. Would merge = score 4 or 5. Attack rules. Error bars resample whole repositories. Caveats: passing tests is a proxy for correct; public tasks may be in training data.",
      body: ({ cap }) => <>
        <p className="kicker">Part 1 · The setting</p>
        <h2>How we know whether the judge was right</h2>
        <div className="grid2">
          <div className="cell"><h4>The answer key: hidden tests</h4>Each task comes from a real project whose maintainers wrote tests for the fix. The judge <b>never sees them</b>. A change that passes is "right"; one that fails is "wrong". Not perfect, but objective.</div>
          <div className="cell"><h4>The score</h4>The judge gives 1–5. We call <b>4 or 5 "would merge"</b>. The headline question: how often does a <i>wrong</i> change get approved?<Scale /></div>
          <div className="cell"><h4>The attack rules</h4>The attacker may rewrite the <b>description</b> and add <b>one test file</b>. It may <b>not touch the code</b>, so the change stays wrong. Three rounds, with the judge's comments as feedback.</div>
          <div className="cell"><h4>Honest statistics</h4>Predictions written before each run. Error bars resample whole repositories. Two judges differ only when their intervals do not overlap.</div>
        </div>
        <Caption show={cap}>Everything that follows is real agent code, a right answer the judge cannot see, and an attacker who cannot change the code.</Caption>
      </> },
    { key: "hook", part: 1, title: "Exhibit A", dur: 18, short: true, note: `A real example: the agent's change fails the task's hidden tests, yet the judge scores it ${demo?.hook?.r7 ?? 4}, would merge. ${demo?.hook?.n_false_accept ?? ""} of 72 wrong changes are approved by this judge before any attacker is involved. The comment sounds like a competent reviewer.`,
      body: ({ cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>Exhibit A: an AI judge approved this wrong fix</h2>
        {demo?.hook ? <Hook h={demo.hook} /> : <p className="muted">loading…</p>}
        <Caption show={cap}>The judge's comment reads like a competent reviewer. It is wrong. {demo?.hook ? `${demo.hook.n_false_accept} of 72 wrong changes get approved by this judge with no attacker involved.` : ""}</Caption>
      </> },
    { key: "signal", part: 1, title: "Better than a coin flip", dur: 15, note: "Be fair first: judges carry signal. For each task we have right and wrong changes; how often does the judge score the right one higher? 50% is a coin flip. Devin, GPT-6.1-sol and GPT-6-luna are at 0.66–0.74 with overlapping intervals; Haiku lower; a line-count rule below chance.",
      body: ({ cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>First, the good news: judges beat a coin flip</h2>
        <p className="lead">For each task we have changes that pass the hidden tests and changes that fail. How often does the judge give the <b>right</b> one the higher score?</p>
        <table className="mini"><thead><tr><th>Judge</th><th>Right change scored above wrong change</th></tr></thead>
          <tbody>{signal.map(([id, j]) => <tr key={id}><td>{name(id)}</td><td className="num">{pct(j.metrics.swe_pair_acc)}</td></tr>)}<tr><td className="muted">Coin flip</td><td className="num muted">50%</td></tr></tbody></table>
        <Caption show={cap}>Every AI judge beats chance and beats a non-AI rule. The best three are statistically tied: <b>no single judge is "the best"</b>.</Caption>
        <More><table className="mini"><tbody>{signal.map(([id, j]) => <tr key={id}><td>{id}</td><td className="num">{ci(j.metrics.swe_pair_acc)}</td></tr>)}</tbody></table>Pair accuracy within task, ties count half; 72 held-out tasks from 11 repositories; 95% intervals resample whole repositories.</More>
      </> },
    { key: "noise", part: 1, title: "The judge vs. itself", dur: 18, beats: 3, note: `Grade the same unchanged pull request three times and the score moves: ${pct(luna?.metrics.retest_drop)} of re-grades come out lower for GPT-6-luna, ${pct(sol?.metrics.retest_drop)} for GPT-6.1-sol. Padding a change with comments moves Devin's score by ${devin?.metrics.length_bias ? devin.metrics.length_bias.value.toFixed(1) : "–"} points. Every catch rate is reported net of this noise.`,
      body: ({ beat, setBeat, cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>The judge does not even agree with itself</h2>
        {demo?.retest ? <Retest rows={demo.retest} beat={beat} onBeat={setBeat} /> : <p className="muted">loading…</p>}
        <div className="bigs">
          <div><div className="big">{pct(luna?.metrics.retest_drop)} / {pct(sol?.metrics.retest_drop)}</div><div className="stat-l">of re-gradings of an <i>unchanged</i> pull request come out lower · GPT-6-luna / GPT-6.1-sol</div></div>
          <div><div className="big">{devin?.metrics.length_bias ? `${devin.metrics.length_bias.value > 0 ? "+" : ""}${devin.metrics.length_bias.value.toFixed(1)}` : "–"}</div><div className="stat-l">points out of 5 that Devin's score moves when the same code is padded with comments</div></div>
        </div>
        <Caption show={cap}>Pure noise looks like judgment. Any claim that a judge "caught" something has to beat this baseline; every rate in this project does.</Caption>
      </> },
    { key: "live", part: 1, title: "Watch a wrong fix get approved", dur: 44, beats: 4, short: true, note: "The central demonstration. The attacker rewrote the description and added a test file; the code is byte-for-byte unchanged and still fails the hidden tests. The score climbs to would merge. The tag after each round shows what happened when we actually ran the attacker's test in a sandbox: often it is a real test, of the wrong behaviour.",
      body: ({ beat, setBeat, playing, cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>Watch a wrong fix get approved without touching the code</h2>
        {demo ? <Attack attacks={attacks} beat={beat} onBeat={setBeat} playing={playing} /> : <p className="muted">loading…</p>}
        <Caption show={cap}>Same wrong code, new words and one test file, and the verdict flips to "would merge". The judge was grading the <b>story</b>, not the code.</Caption>
      </> },
    { key: "agg", part: 1, title: "It works at scale, and it transfers", dur: 16, note: `Across ${nAttacked} held-out tasks: wrong changes approved go ${pct(sol?.metrics.attack_gate_before)} → ${pct(sol?.metrics.attack_gate_rate)} (GPT-6.1-sol) and ${pct(luna?.metrics.attack_gate_before)} → ${pct(luna?.metrics.attack_gate_rate)} (GPT-6-luna). Fair control: right changes got the same attacker, and the attacked wrong change still outscored every attacked right one ${pct(luna?.metrics.attack_win_fair)}–${pct(sol?.metrics.attack_win_fair)} of the time. Attacks built against one judge work on the other and on reworded prompts.`,
      body: ({ cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>Not a fluke: it works on most tasks, and on other judges</h2>
        <div className="bigs">
          {att.map(([id, j]) => <div key={id}><div className="big">{pct(j.metrics.attack_gate_before)} → <CountUp to={j.metrics.attack_gate_rate?.value} /></div><div className="stat-l">wrong changes approved, before → after attack · judge {name(id)}</div></div>)}
        </div>
        {sc && <AttackChart judges={att} height={170} />}
        <Caption show={cap}>Attacks built against one judge also work on the other and on reworded prompts: the weakness is <b>structural</b>. Even when right changes get the same attacker, the wrong one still wins {pct(luna?.metrics.attack_win_fair)}–{pct(sol?.metrics.attack_win_fair)} of the time.</Caption>
        <More>Attacks tuned on GPT-6-luna replayed on GPT-6.1-sol: {pct(sol?.metrics.attack_gate_xfer_before)} → {pct(sol?.metrics.attack_gate_xfer)}; the reverse: {pct(luna?.metrics.attack_gate_xfer_before)} → {pct(luna?.metrics.attack_gate_xfer)}. Devin and Claude were not run under attack.</More>
      </> },
    { key: "opt", part: 1, title: "Picking the best attempt", dur: 18, note: `Best-of-N: the judge picks one of N attempts; the pick's real success rises from ${pct(bo("1"))} to ${pct(bo("4"))} at four attempts, then stops; a perfect picker reaches ${pct(sol?.best_of_n?.["8"]?.oracle)}. Goodhart: keep adding candidates, including attacked ones, and the judge's score of its pick keeps rising while the pick's real success falls.`,
      body: ({ cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>Using the judge to pick the best attempt: helps a little, then hurts</h2>
        <div className="cols">
          <div>{sc && <BestOfNChart judges={(["rubric-gpt6.1-sol", "rubric-gpt6-luna"] as const).filter((id) => J[id]).map((id) => [id, J[id]] as const)} height={200} />}
            <p className="small muted"><b>More attempts.</b> Real success of the judge's pick: {pct(bo("1"))} with 1 attempt, {pct(bo("4"))} with 4, {pct(bo("8"))} with 8; a perfect picker would reach {pct(sol?.best_of_n?.["8"]?.oracle)}.</p></div>
          <div>{sc && <GoodhartChart judges={gh} height={200} />}
            <p className="small muted"><b>More optimisation.</b> Solid: how often the pick is actually right. Dashed: how highly the judge rates it. Add attacked candidates and the judge gets happier while the picks get worse.</p></div>
        </div>
        <Caption show={cap}>Optimising against the judge works until it doesn't: past a point the score goes up while real quality goes down. That is what happens to an agent trained on this score.</Caption>
      </> },
    { key: "gate", part: 1, title: "A higher bar does not help", dur: 14, note: "We tuned the cutoff on separate tasks. The tuned cutoff is 2 or more, which lets about 60% of wrong changes through; the strict cutoff 4 or more rejects about 97% of right changes. No cutoff is both safe and usable.",
      body: ({ cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>"Just set a higher bar" does not work</h2>
        <p className="lead">We picked the best passing score on separate tasks, then tested it.</p>
        <table className="mini"><thead><tr><th>Judge</th><th>Best cutoff found</th><th>Wrong changes let through</th><th>Right changes rejected</th></tr></thead>
          <tbody>{[sol, luna].map((j, k) => j && <tr key={k}><td>{name(k === 0 ? "rubric-gpt6.1-sol" : "rubric-gpt6-luna")}</td><td className="num">score ≥ {j.swe_cutoff ?? "–"}</td><td className="num">{pct(j.metrics.swe_false_accept_cal)}</td><td className="num">{pct(j.metrics.swe_false_reject_cal)}</td></tr>)}</tbody></table>
        <p className="small muted">At the strict cutoff "4 or more", the same judges reject about 97% of changes that actually pass the tests.</p>
        <Caption show={cap}>The score can <b>rank</b> candidates for the same task. It cannot be a pass/fail <b>gate</b>.</Caption>
      </> },
    { key: "defences", part: 2, title: "Three fixes", dur: 26, short: true, note: "Three fixes, same attacks. Running the PR's own tests: the judge then ignores fake tests, but about 45% of the attacker's tests are real tests of the wrong behaviour. Checking other agents: 60% of wrong tests are also passed by other agents' wrong attempts. Hiding description and tests: nothing to attack, but the judge already approves wrong changes far more often. Ranking is unchanged at every step. Bars 3 and 4 replay attacks tuned against the previous judge.",
      body: ({ cap }) => <>
        <p className="kicker">Part 3 · Can it be fixed?</p>
        <h2>Three obvious fixes. Each removes some of the attack; none removes half.</h2>
        {modelPicker}
        {sc && <Ladder J={J} model={model} />}
        <Caption show={cap}>A test of <i>what the patch does</i> looks identical, when run, to a test of <i>what the task needs</i>, and other agents make the same mistakes. <b>The fix has to be tests nobody involved wrote.</b></Caption>
      </> },
    { key: "channels", part: 2, title: "Which part of the PR matters", dur: 20, note: "Hide channels from the prompt and re-run. Code only ranks as well as the full judge, so description and tests add no ranking signal. But the test file is where the attack lives (78–88% of the effect) and the only place where test tampering is visible; the description matters little (17–24%).",
      body: ({ cap }) => <>
        <p className="kicker">Part 3 · Can it be fixed?</p>
        <h2>Which part of the pull request matters?</h2>
        {modelPicker}
        {sc && <Channels J={J} model={model} />}
        <Caption show={cap}>The judge's <b>knowledge</b> comes from the code. The attacker's <b>lever</b> is the test file, which is also the only place where cheating on tests can be seen. You can neither hide it nor trust it.</Caption>
        {consensus?.attacker_fail_corroborated && <More>Cross-agent check (4,428 sandbox runs): {pct(consensus.attacker_fail_corroborated)} of the attacker's real tests on wrong changes also pass on another agent's attempt; {pct(consensus.genuine_pass_corroborated)} of genuine tests from right changes do.</More>}
      </> },
    { key: "preds", part: 3, title: "21 predictions, written first", dur: 18, note: "Every experiment had numeric predictions committed before the run; the test set is reported once. Predictions about judge behaviour mostly came true; predictions that a fix would work mostly did not, each time because an assumption about the attack was wrong.",
      body: ({ cap }) => <>
        <p className="kicker">Part 4 · Bottom line</p>
        <h2>We said what we expected before every experiment</h2>
        <Preds />
        <Caption show={cap}>Predictions about how judges <i>behave</i> mostly came true. Predictions that a <i>fix would work</i> mostly did not. The failures are the findings.</Caption>
      </> },
    { key: "end", part: 3, title: "What this shows", dur: 22, short: true, note: "Close: AI code judges carry real signal but can be flipped without a code change; the weakness transfers, compounds under optimisation, cannot be thresholded away, and survives the standard fixes. Not shown: that any judge is safe or best, that passing tests means good code, agreement with human reviewers. Next: tests generated from the task before seeing any code.",
      body: ({ cap }) => <>
        <p className="kicker">Part 4 · Bottom line</p>
        <h2>What this shows, what it doesn't, what's next</h2>
        <div className="grid2">
          <div className="cell"><h4>Shows</h4>AI code judges know something about right and wrong code, but can be flipped from "reject" to "approve" without a code change. That weakness transfers between judges, worsens under optimisation, cannot be fixed with a cutoff, and survives the standard fixes.</div>
          <div className="cell"><h4>Does not show</h4>That any judge is safe or best. That passing tests means good code. That judges agree with human reviewers: the available human labels were too weak to tell.</div>
          <div className="cell"><h4>Not yet done</h4>Devin and Claude under attack. An attacker who knows about the cross-agent check. Tests generated from the task <i>before</i> seeing any code, the one fix the results point to.</div>
          <div className="cell"><h4>How to use it</h4>A regression test for anyone choosing or changing a code judge: which is more gameable, noisier, worse at ranking, with error bars. Use the judge to rank; gate on evidence the agent did not write.</div>
        </div>
        <Caption show={cap}>Everyone is optimising against the referee and assuming it is honest. It is honest about 70% of the time, and it can be talked into the rest.</Caption>
        <p className="small muted" style={{ marginTop: 10 }}>Full numbers and method: <Link to="/overview">Overview</Link>, <Link to="/findings">Findings</Link>, <Link to="/board">Leaderboard</Link>, <Link to="/play">Fool the judge</Link>, <Link to="/method">Method</Link>.</p>
      </> },
  ];

  const order = useMemo(() => scenes.map((_, k) => k).filter((k) => !short || scenes[k].short), [short, scenes.length]);
  const pos = Math.max(0, order.indexOf(i));
  const s = scenes[i];
  const total = order.reduce((a, k) => a + scenes[k].dur, 0);
  const before = order.slice(0, pos).reduce((a, k) => a + scenes[k].dur, 0);
  const goTo = useCallback((k: number) => { setI(k); setBeatRaw(0); setElapsed(0); }, []);
  const go = useCallback((d: number) => { const k = order[Math.min(order.length - 1, Math.max(0, pos + d))]; if (k !== i) goTo(k); else if (d > 0) setPlaying(false); }, [order, pos, i, goTo]);
  const setBeat = useCallback((b: number) => { setBeatRaw(b); setPlaying(false); }, []);

  const tickRef = useRef(0);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setElapsed((e) => e + 0.1), 100);
    return () => clearInterval(id);
  }, [playing]);
  useEffect(() => {
    if (!playing) return;
    const beats = s.beats ?? 1;
    const b = Math.min(beats - 1, Math.floor((elapsed / s.dur) * beats));
    if (b !== beat) setBeatRaw(b);
    if (elapsed >= s.dur) { if (pos < order.length - 1) goTo(order[pos + 1]); else setPlaying(false); }
    tickRef.current = elapsed;
  }, [elapsed, playing, s, beat, pos, order, goTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); go(1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
      if (e.key === " " || e.key === "k") { e.preventDefault(); setPlaying((p) => !p); }
      if (e.key === "n" || e.key === "N") setNotes((x) => !x);
      if (e.key === "s" || e.key === "S") { setShort((x) => !x); goTo(0); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, goTo]);

  const cap = !playing || elapsed > s.dur * 0.3;
  const frac = Math.min(1, (before + Math.min(elapsed, s.dur)) / total);
  let acc = 0;
  const ticks = order.map((k) => { const x = acc / total; acc += scenes[k].dur; return { k, x, part: k === 0 || scenes[k].part !== scenes[order[order.indexOf(k) - 1]]?.part }; });
  const firstOf = (p: number) => order.find((k) => scenes[k].part === p);

  return (
    <div className="player">
      <div className="screen">
        <div className="scene" key={`${s.key}-${short}`}>{s.body({ beat, setBeat, playing, cap })}</div>
      </div>
      {notes && <div className="notes"><b>Speaker notes.</b> {s.note}</div>}
      <div className="scrub" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; const t = [...ticks].reverse().find((tk) => tk.x <= x) ?? ticks[0]; goTo(t.k); }}>
        <div className="track" /><div className="fill" style={{ width: `${frac * 100}%` }} />
        {ticks.map((t) => <div key={t.k} className={`tick ${t.part ? "part" : ""}`} style={{ left: `${t.x * 100}%` }} />)}
        <div className="head" style={{ left: `${frac * 100}%` }} />
      </div>
      <div className="chapters">{PARTS.map((label, p) => <span key={p} className={s.part === p ? "on" : ""} onClick={() => { const k = firstOf(p); if (k != null) goTo(k); }}>Part {p + 1} · {label}</span>)}</div>
      <div className="bar">
        <button className="pbtn ghost" onClick={() => go(-1)} disabled={pos === 0} title="previous (←)">‹</button>
        <button className="pbtn" onClick={() => setPlaying((p) => !p)} title="play / pause (space)">{playing ? "❚❚" : "▶"}</button>
        <button className="pbtn ghost" onClick={() => go(1)} disabled={pos === order.length - 1} title="next (→)">›</button>
        <span className="title">{pos + 1} / {order.length} · {s.title}</span>
        <span className="time">{fmt(before + Math.min(elapsed, s.dur))} / {fmt(total)}</span>
        <button className={`btn ${short ? "on" : ""}`} onClick={() => { setShort((x) => !x); goTo(0); }}>{short ? "2-minute cut" : "full cut"}</button>
        <button className={`btn ${notes ? "on" : ""}`} onClick={() => setNotes((x) => !x)}>notes</button>
      </div>
      <p className="hint">Space plays and pauses · ← → step · click the timeline to jump · N notes · S short cut. Everything on screen stays interactive while paused.</p>
    </div>
  );
}
