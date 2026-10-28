import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Diff from "../Diff";
import { AttackChart, BestOfNChart, DefenceChart, GoodhartChart } from "../charts";
import { useData } from "../data";
import { PREDICTIONS } from "../predictions";
import type { Demo as DemoData, DemoAttack, DemoHook, DemoRetest, JudgeCard, Metric, Scorecard } from "../types";

const NAMES: Record<string, string> = {
  "devin-rubric": "Devin",
  "rubric-gpt6.1-sol": "GPT-6.1-sol",
  "rubric-gpt6-luna": "GPT-6-luna",
  "merge-zs-gpt6.1-sol": "GPT-6.1-sol (simpler prompt)",
  "merge-zs-gpt6-luna": "GPT-6-luna (simpler prompt)",
  "rubric-haiku4.5": "Claude Haiku 4.5",
  "heuristic-tests": "No AI: count the lines",
  "rubricx-gpt6.1-sol": "GPT-6.1-sol + runs the tests",
  "rubricx-gpt6-luna": "GPT-6-luna + runs the tests",
  "rubricxc-gpt6.1-sol": "GPT-6.1-sol + tests + other agents",
  "rubricxc-gpt6-luna": "GPT-6-luna + tests + other agents",
};
const MODELS = [["gpt6-luna", "GPT-6-luna"], ["gpt6.1-sol", "GPT-6.1-sol"]] as const;
const SECTIONS = ["The setting", "What we found", "Can it be fixed?", "Bottom line"];
const KEYS = ["title", "pipeline", "why", "truth", "hook", "signal", "noise", "live", "agg", "opt", "gate", "defences", "channels", "preds", "end"];
const SECTION_OF: Record<string, number> = { title: 0, pipeline: 0, why: 0, truth: 0, hook: 1, signal: 1, noise: 1, live: 1, agg: 1, opt: 1, gate: 1, defences: 2, channels: 2, preds: 3, end: 3 };
const SHORT_KEYS = new Set(["title", "pipeline", "hook", "live", "defences", "end"]);
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
  empty: "no runnable test",
  error: "the test could not be run",
};
const gate = (j: JudgeCard | undefined, own: boolean) =>
  own ? [j?.metrics.attack_gate_before?.value, j?.metrics.attack_gate_rate?.value] : [j?.metrics.attack_gate_xfer_before?.value, j?.metrics.attack_gate_xfer?.value];
const lift = (j: JudgeCard | undefined, own: boolean) => { const [b, a] = gate(j, own); return b == null || a == null ? null : a - b; };

const T = ({ t, children }: { t: string; children: ReactNode }) => <span className="term" title={t}>{children}</span>;
const Takeaway = ({ children }: { children: ReactNode }) => <div className="takeaway"><b>Takeaway.</b> {children}</div>;
const More = ({ title = "Details and exact numbers", children }: { title?: string; children: ReactNode }) => <details className="more"><summary>{title}</summary>{children}</details>;
const Scale = () => (
  <div className="scale"><span className="bad">1</span><span className="bad">2 · reject</span><span className="mid">3 · needs changes</span><span className="good">4 · would merge</span><span className="good">5</span></div>
);

function Hook({ h }: { h: DemoHook }) {
  return (
    <div>
      <div className="rounds">
        <span className={`score ${cls(h.r7)}`}>Score {h.r7} / 5</span>
        <span className="small muted">= "{verdictWord(h.r7)}" · judge: {name(h.judge)}</span>
        <span className="tag bad">reality: the patch fails the hidden tests</span>
        <a className="small" href={h.url} target="_blank" rel="noreferrer">{h.repo} ↗</a>
      </div>
      <p className="reason"><b>What the judge said:</b> {h.reason}</p>
      <div className="cols">
        <div className="panel"><h4>The bug report the agent was asked to fix</h4><pre className="desc">{h.task.slice(0, 1100)}{h.task.length > 1100 ? " …" : ""}</pre></div>
        <div className="panel"><h4>The agent's code change (red = removed, green = added)</h4><Diff text={h.diff} maxLines={100} /></div>
      </div>
    </div>
  );
}

function Retest({ rows }: { rows: DemoRetest[] }) {
  const [idx, setIdx] = useState(0);
  const [k, setK] = useState(0);
  const r = rows[idx];
  if (!r) return <p className="muted">No re-grade data exported.</p>;
  return (
    <div>
      <p className="howto">Pick a pull request, then click the three gradings. Nothing changed between them: same code, same prompt, same model.</p>
      <div className="rounds">
        <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setK(0); }}>
          {rows.map((x, i) => <option key={i} value={i}>{x.parent} · {name(x.judge)} · scores {x.scores.join(" / ")}</option>)}
        </select>
        <a className="small" href={r.url} target="_blank" rel="noreferrer">PR ↗</a>
      </div>
      <div className="rounds">
        {r.scores.map((_, i) => <button key={i} className={`btn ${k === i ? "on" : ""}`} onClick={() => setK(i)}>Grading {i + 1}</button>)}
        <span style={{ marginLeft: "auto" }}><span className={`score ${cls(r.scores[k])}`}>Score {r.scores[k]} / 5</span> <span className="small muted">{verdictWord(r.scores[k])}</span></span>
      </div>
      <p className="reason"><b>{name(r.judge)} said:</b> {r.reasons[k]}</p>
    </div>
  );
}

function Attack({ attacks }: { attacks: DemoAttack[] }) {
  const [idx, setIdx] = useState(0);
  const [rnd, setRnd] = useState(0);
  const a = attacks[idx];
  if (!a) return <p className="muted">No cached attack exported yet.</p>;
  const cur = rnd === 0 ? null : a.rounds[rnd - 1];
  const r7 = cur ? cur.r7 : a.before.r7;
  return (
    <div>
      <p className="howto">Click <b>Before</b>, then <b>Round 1, 2, 3</b>. Watch the score. The code change itself (right panel, "Before") is never edited; the attacker only rewrites the description and adds a test file.</p>
      <div className="rounds">
        <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setRnd(0); }}>
          {attacks.map((x, i) => (
            <option key={i} value={i}>{x.target.split("::")[0]} · judge {name(x.judge)} · score {x.before.r7} → {Math.max(...x.rounds.map((r) => r.r7))}</option>
          ))}
        </select>
        <span className="tag bad">reality, unchanged throughout: the patch fails the hidden tests</span>
        <a className="small" href={a.url} target="_blank" rel="noreferrer">bug report ↗</a>
      </div>
      <div className="rounds">
        <button className={`btn ${rnd === 0 ? "on" : ""}`} onClick={() => setRnd(0)}>Before</button>
        {a.rounds.map((r, i) => (
          <button key={r.round} className={`btn ${rnd === i + 1 ? "on" : ""}`} onClick={() => setRnd(i + 1)}>Round {r.round}</button>
        ))}
        <span style={{ marginLeft: "auto" }}>
          <span className={`score ${cls(r7)}`}>Score {r7} / 5</span>{" "}
          <span className="small muted">{verdictWord(r7)}</span>
        </span>
      </div>
      <p className="reason"><b>{name(a.judge)} said:</b> {cur ? cur.reason : a.before.reason}
        {cur?.verdict && <> · <span className={`tag ${cur.verdict === "verified" ? "good" : "bad"}`}>{VERDICT[cur.verdict] ?? cur.verdict}</span></>}
      </p>
      <div className="cols">
        <div className="panel">
          <h4>{cur ? `Description, rewritten by the attacker (round ${cur.round})` : "Description, as the agent submitted it"}</h4>
          <pre className="desc">{cur ? cur.description : a.description || "(the agent wrote none)"}</pre>
        </div>
        <div className="panel">
          <h4>{cur ? "Test file the attacker added. The code change is untouched." : "The code change (this is what fails the hidden tests)"}</h4>
          <Diff text={cur ? cur.test_file || "(no new test file this round)" : a.diff} maxLines={200} />
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
      <DefenceChart steps={steps.map((s) => ({ label: s.label, before: s.g[0] ?? null, after: s.g[1] ?? null }))} height={240} />
      <div className="ladder">
        {steps.map((s) => (
          <div className="cell" key={s.label}>
            <h4>{s.label}</h4>
            <div className="big">{pctv(s.g[0])} → {pctv(s.g[1])}</div>
            <div className="small muted">wrong patches approved, before → after attack. {s.what}.</div>
            <div className="small" style={{ marginTop: 6 }}><b>What the attacker still has:</b> {s.left}</div>
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
        Tells right from wrong patches <b>as well as the full judge</b> ({ci(code?.metrics.swe_pair_acc)} vs {ci(full?.metrics.swe_pair_acc)}).
        But it approves the untouched wrong patch <b>{pctv(gate(code, false)[0])}</b> of the time (full judge: {pctv(gate(full, true)[0])}),
        and it cannot see any test tampering: it catches <b>{pct(code?.metrics.hack_catch_rate)}</b> of deleted or gutted tests (full judge: {pct(full?.metrics.hack_catch_rate)}).</div>
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
      <div className="tally">
        <span className="held">{tally("held")} came true</span><span className="failed">{tally("failed")} did not</span>
        <span className="ill-posed">{tally("ill-posed")} could not be tested as written</span>
      </div>
      <div className="preds">
        {PREDICTIONS.map((p) => (
          <div className={`pred ${p.result}`} key={p.id}><span className="pid">{p.id}</span><span>{p.text}<br /><span className="note">{p.result === "held" ? "came true" : p.result === "failed" ? "did not" : p.result}: {p.note}</span></span></div>
        ))}
      </div>
    </div>
  );
}

export default function Demo() {
  const sc = useData<Scorecard>("scorecard.json");
  const demo = useData<DemoData>("demo.json");
  const [i, setI] = useState(0);
  const [notes, setNotes] = useState(false);
  const [short, setShort] = useState(false);
  const [model, setModel] = useState<string>("gpt6-luna");
  const J = sc?.judges ?? {};
  const sol = J["rubric-gpt6.1-sol"], luna = J["rubric-gpt6-luna"], devin = J["devin-rubric"];
  const signal = Object.entries(J)
    .filter(([id, j]) => j.metrics.swe_pair_acc && id in NAMES && !id.startsWith("rubricx") && !id.startsWith("merge-zs"))
    .sort((a, b) => (b[1].metrics.swe_pair_acc?.value ?? 0) - (a[1].metrics.swe_pair_acc?.value ?? 0));
  const att = Object.entries(J).filter(([id, j]) => j.metrics.attack_gate_rate && !id.startsWith("rubricx"));
  const gh = Object.entries(J).filter(([id, j]) => j.goodhart?.pool_plus_attack_r3 && !id.startsWith("rubricx"));
  const bo = (n: string) => sol?.best_of_n?.[n]?.judge;
  const attacks = useMemo(() => (demo?.attacks ?? []).filter((a) => a.judge.startsWith("rubric-")).concat((demo?.attacks ?? []).filter((a) => !a.judge.startsWith("rubric-"))), [demo]);
  const consensus = sc?.consensus as Record<string, Metric> | undefined;
  const modelPicker = (
    <span className="rounds" style={{ margin: "0 0 8px" }}>
      <span className="small muted">Judge model:</span>
      {MODELS.map(([m, label]) => <button key={m} className={`btn ${model === m ? "on" : ""}`} onClick={() => setModel(m)}>{label}</button>)}
    </span>
  );
  const nAttacked = sol?.metrics.attack_gate_rate?.n ?? 72;

  const slides: { key: string; body: ReactNode; note: string }[] = [
    { key: "title", note: "Opening. The one-sentence version: AI coding agents are now checked by other AIs; we tested whether that checker can be trusted, and found it can be gamed cheaply without changing a line of code. Everything in the deck is a measurement on real agent-written patches with a known right answer.",
      body: <section className="slide">
        <p className="kicker">JudgeBench-Code</p>
        <h1>AI now writes code. Another AI grades it.<br />Can that grader be trusted?</h1>
        <p className="lead">We built a benchmark that tests the <b>grader</b>, not the coder, on 751 real changes written by AI coding agents, each with a known right answer. The grader does carry real signal, but it can be pushed from "reject" to "approve" <b>without changing a single line of the code</b>, and the obvious fixes only half work.</p>
        <ul className="plain">
          <li><b>Part 1</b> explains the setting in plain terms (3 screens).</li>
          <li><b>Part 2</b> shows what we found, including one real attack you can replay.</li>
          <li><b>Part 3</b> tests three fixes. <b>Part 4</b> is the bottom line.</li>
        </ul>
        <p className="small muted">Step with → or space, or the buttons below. Each screen ends with a takeaway; numbers are behind "Details". <kbd>N</kbd> speaker notes · <kbd>S</kbd> 2-minute version.</p>
      </section> },

    { key: "pipeline", note: "Define the actors. A coding agent is an AI system like Devin or Codex that takes a bug report and produces a code change (a pull request). A judge is a second AI model that reads the change and scores it 1 to 5, like a code reviewer. Platforms put the judge in three places: deciding a task is finished, picking the best of several attempts, and as the reward when training agents. In none of those is a human in the loop.",
      body: <section className="slide">
        <p className="kicker">Part 1 · The setting</p>
        <h2>Who writes the code, and who checks it</h2>
        <div className="pipeline">
          <div className="node"><h4>1. A task</h4><p>A bug report or feature request from a real open-source project, e.g. "requests breaks when the HTTP method is a byte string".</p></div>
          <div className="arrow">→</div>
          <div className="node"><h4>2. A coding agent</h4><p>An AI system (Devin, Codex, Claude Code, …) reads the task and writes a <T t="A proposed change to the code, with a description and sometimes tests">pull request</T>: code changes, a description, maybe tests.</p></div>
          <div className="arrow">→</div>
          <div className="node hot"><h4>3. An AI judge</h4><p>A second AI model reads the pull request and scores it from <b>1 to 5</b>, like a reviewer. <b>This is what we test.</b></p><Scale /></div>
          <div className="arrow">→</div>
          <div className="node"><h4>4. A decision, no human</h4><p>Score ≥ 4 means "would merge". Platforms use it to decide a task is finished, to pick the best of several attempts, and as the reward signal when training agents.</p></div>
        </div>
        <Takeaway>The judge is a second AI grading the first AI's homework. It is cheap and fast, so it has quietly become the referee in the agent pipeline. Nobody had measured how good a referee it is.</Takeaway>
      </section> },

    { key: "why", note: "Why it matters: each place the judge sits turns a judge error into a product or training failure. If the judge is not just noisy but gameable, then anything optimised against it, including the agent being trained, drifts toward pleasing the judge rather than being right. That is Goodhart's law. What is new here: controlled measurement on real agent patches with execution ground truth, an adaptive attacker that cannot touch the code, pre-registered predictions, and tests of the obvious defences.",
      body: <section className="slide">
        <p className="kicker">Part 1 · The setting</p>
        <h2>Why a bad referee is worse than a bad player</h2>
        <div className="cards">
          <div className="card"><h4>It gates merges</h4>If the judge approves wrong code, wrong code ships. The judge's score is also the number the team sees, so nobody notices.</div>
          <div className="card"><h4>It picks the winner</h4>Agents often make several attempts and let the judge choose. A judge that prefers the wrong attempt makes "try more" useless.</div>
          <div className="card"><h4>It trains the next agent</h4>When the judge's score is the reward, agents learn to please the judge. If the judge can be pleased without being right, agents learn exactly that.</div>
        </div>
        <h3 style={{ margin: "18px 0 6px" }}>What we built, and what is new about it</h3>
        <ul className="plain">
          <li><b>Ground truth.</b> 751 real changes written by 30+ coding agents for 105 real tasks, where every change has a known answer: hidden tests it passes or fails.</li>
          <li><b>An adversary.</b> An attacker AI that may only rewrite the description and add one test file, never the code, and gets three tries with the judge's feedback.</li>
          <li><b>Pre-registration.</b> 21 predictions written down and committed <i>before</i> each experiment, so the results cannot be cherry-picked.</li>
          <li><b>Fixes, tested.</b> Running the tests in a sandbox, cross-checking against other agents (4,428 sandbox runs), hiding channels from the judge.</li>
        </ul>
        <Takeaway>This is, to our knowledge, the first controlled measurement of how much real signal AI code judges carry, how cheaply they can be gamed, and whether the standard defences work.</Takeaway>
      </section> },

    { key: "truth", note: "The method in one slide. Hidden tests: for each task the project maintainers wrote tests that check the fix; the judge never sees them; we use them as the answer key. 'Would merge' = score 4 or 5. The attack rules. Confidence intervals: all computed by resampling whole repositories, so correlated tasks don't inflate confidence. Caveats to state up front: passing tests is a proxy for correct, and these public tasks may have been in the models' training data.",
      body: <section className="slide">
        <p className="kicker">Part 1 · The setting</p>
        <h2>How we know whether the judge was right</h2>
        <div className="cards">
          <div className="card"><h4>The answer key: hidden tests</h4>Each task comes from a real project whose maintainers wrote tests for the fix. The judge <b>never sees them</b>. A change that passes them is "right"; one that fails is "wrong". Not perfect (code can pass tests and still be ugly), but objective.</div>
          <div className="card"><h4>The score</h4>The judge gives 1–5. We call <b>4 or 5 "would merge"</b>: the change is approved. The headline question is how often a <i>wrong</i> change gets approved.<Scale /></div>
          <div className="card"><h4>The attack rules</h4>The attacker AI may rewrite the pull request's <b>description</b> and add <b>one test file</b>. It may <b>not touch the code</b>, so the change stays wrong. It sees the judge's score and comments and gets three rounds.</div>
          <div className="card"><h4>Honest statistics</h4>Predictions were written before each run. Error bars resample whole repositories, not single tasks. Two judges are "different" only when their intervals do not overlap.</div>
        </div>
        <Takeaway>Everything that follows is: real agent code, a known right answer the judge cannot see, and an attacker who cannot change the code.</Takeaway>
      </section> },

    { key: "hook", note: `A real held-out example: the agent's change fails the task's hidden tests, yet the judge scores it ${demo?.hook?.r7 ?? "4"}, "would merge". ${demo?.hook?.n_false_accept ?? ""} of 72 wrong changes are approved by this judge before any attack. Read the judge's comment: it sounds reasonable. That is the problem: a confident, articulate reviewer that is wrong.`,
      body: <section className="slide">
        <p className="kicker">Part 2 · What we found</p>
        <h2>Exhibit A: an AI judge approved this wrong fix</h2>
        <p className="lead">A coding agent tried to fix a real bug. Its change <b>fails the project's tests</b>. The AI judge read it and said "would merge".</p>
        {demo?.hook ? <Hook h={demo.hook} /> : <p className="muted">loading…</p>}
        <Takeaway>The judge's comment sounds like a competent reviewer. It is wrong. {demo?.hook ? `${demo.hook.n_false_accept} of 72 wrong changes get approved by this judge with no attacker involved.` : ""}</Takeaway>
      </section> },

    { key: "signal", note: "Before showing failures, be fair: judges do carry signal. For each task we have right and wrong changes; the metric is how often the judge gives the right one the higher score. 50% is a coin flip. Devin, GPT-6.1-sol and GPT-6-luna are at 0.66–0.74 with overlapping intervals; Haiku lower; a non-AI line-count rule is below chance. Caveat: the tasks are public and may be in training data.",
      body: <section className="slide">
        <p className="kicker">Part 2 · What we found</p>
        <h2>First, the good news: judges are better than a coin flip</h2>
        <p className="lead">For each task we have changes that pass the hidden tests and changes that fail. How often does the judge give the <b>right</b> one the higher score? A coin flip gets 50%.</p>
        <table className="mini">
          <thead><tr><th>Judge</th><th>Right change scored above wrong change</th></tr></thead>
          <tbody>
            {signal.map(([id, j]) => <tr key={id}><td>{name(id)}</td><td className="num">{pct(j.metrics.swe_pair_acc)}</td></tr>)}
            <tr><td className="muted">Coin flip</td><td className="num muted">50%</td></tr>
          </tbody>
        </table>
        <Takeaway>Every AI judge beats chance, and beats a non-AI rule. The best three are statistically tied: <b>no single judge is "the best"</b>.</Takeaway>
        <More><table className="mini"><tbody>{signal.map(([id, j]) => <tr key={id}><td>{id}</td><td className="num">{ci(j.metrics.swe_pair_acc)}</td></tr>)}</tbody></table>
          Pair accuracy within task, ties count half; 72 held-out tasks from 11 repositories; 95% intervals resample whole repositories.</More>
      </section> },

    { key: "noise", note: `Grade the same unchanged pull request three times and the score moves. ${pct(luna?.metrics.retest_drop)} of re-grades come out lower for GPT-6-luna, ${pct(sol?.metrics.retest_drop)} for GPT-6.1-sol. Padding a change with comments moves Devin's score by ${devin?.metrics.length_bias ? devin.metrics.length_bias.value.toFixed(1) : "–"} points. We subtract this noise from every 'the judge caught it' rate.`,
      body: <section className="slide">
        <p className="kicker">Part 2 · What we found</p>
        <h2>The judge does not even agree with itself</h2>
        {demo?.retest ? <Retest rows={demo.retest} /> : <p className="muted">loading…</p>}
        <div className="bigs">
          <div><div className="big">{pct(luna?.metrics.retest_drop)} / {pct(sol?.metrics.retest_drop)}</div><div className="stat-l">of re-gradings of an <i>unchanged</i> pull request come out lower · GPT-6-luna / GPT-6.1-sol</div></div>
          <div><div className="big">{devin?.metrics.length_bias ? `${devin.metrics.length_bias.value > 0 ? "+" : ""}${devin.metrics.length_bias.value.toFixed(1)}` : "–"}</div><div className="stat-l">points (out of 5) that Devin's score moves when the same code is padded with comments</div></div>
        </div>
        <Takeaway>Pure noise looks like judgment. Any claim that a judge "caught" something has to beat this baseline, and every rate in this project does.</Takeaway>
      </section> },

    { key: "live", note: "The central demonstration. Pick an example; click Before, then the rounds. The attacker rewrote the description and added a test file; the code is byte-for-byte unchanged and still fails the hidden tests. The score climbs to 'would merge'. The tag after round comments shows what happens when we actually run the attacker's test in a sandbox: often it is a real test, of the wrong behaviour.",
      body: <section className="slide">
        <p className="kicker">Part 2 · What we found</p>
        <h2>Watch a wrong fix get approved without touching the code</h2>
        {demo ? <Attack attacks={attacks} /> : <p className="muted">loading…</p>}
        <Takeaway>Same wrong code, new words and one test file, and the verdict flips to "would merge". The judge was grading the <b>story</b>, not the code.</Takeaway>
      </section> },

    { key: "agg", note: `Across ${nAttacked} held-out tasks: wrong changes approved go ${pct(sol?.metrics.attack_gate_before)} → ${pct(sol?.metrics.attack_gate_rate)} for GPT-6.1-sol and ${pct(luna?.metrics.attack_gate_before)} → ${pct(luna?.metrics.attack_gate_rate)} for GPT-6-luna. Fair control: we gave the right changes the same attacker, and the attacked wrong change still outscored every attacked right one ${pct(luna?.metrics.attack_win_fair)}–${pct(sol?.metrics.attack_win_fair)} of the time. Attacks built against one judge work on the other and on differently worded prompts.`,
      body: <section className="slide">
        <p className="kicker">Part 2 · What we found</p>
        <h2>It is not a fluke: it works on most tasks and on other judges</h2>
        <p className="lead">We ran the attack on {nAttacked} tasks. How many <b>wrong</b> changes are approved before and after?</p>
        <div className="bigs">
          {att.map(([id, j]) => (
            <div key={id}><div className="big">{pct(j.metrics.attack_gate_before)} → {pct(j.metrics.attack_gate_rate)}</div><div className="stat-l">wrong changes approved, before → after attack · judge {name(id)}</div></div>
          ))}
        </div>
        {sc && <AttackChart judges={att} height={200} />}
        <Takeaway>Attacks built against one judge also work on the other judge and on differently worded prompts: the weakness is <b>structural</b>, not a quirk of one model. Even when the right changes get the same attacker, the wrong one still wins {pct(luna?.metrics.attack_win_fair)}–{pct(sol?.metrics.attack_win_fair)} of the time.</Takeaway>
        <More>Attacks tuned on GPT-6-luna replayed on GPT-6.1-sol: {pct(sol?.metrics.attack_gate_xfer_before)} → {pct(sol?.metrics.attack_gate_xfer)}; the reverse: {pct(luna?.metrics.attack_gate_xfer_before)} → {pct(luna?.metrics.attack_gate_xfer)}. Fair win = attacked wrong change scores above every attacked right change for its task. Devin and Claude were not run in the attack setting.</More>
      </section> },

    { key: "opt", note: `Two uses of the judge as a selector. Best-of-N: let the agent make N attempts and the judge pick one; the pick's real success rate rises from ${pct(bo("1"))} at one attempt to ${pct(bo("4"))} at four, then stops improving; a perfect picker would reach ${pct(sol?.best_of_n?.["8"]?.oracle)}. Goodhart: keep adding candidates, including attacked ones, and the judge's score of its pick keeps rising while the pick's real success falls (0.51 → 0.70 → 0.49 for sol; 0.51 → 0.61 → 0.31 for luna).`,
      body: <section className="slide">
        <p className="kicker">Part 2 · What we found</p>
        <h2>Using the judge to pick the best attempt: helps a little, then hurts</h2>
        <div className="cols">
          <div>{sc && <BestOfNChart judges={(["rubric-gpt6.1-sol", "rubric-gpt6-luna"] as const).filter((id) => J[id]).map((id) => [id, J[id]] as const)} height={230} />}
            <p className="small muted"><b>More attempts.</b> Let the agent try N times and the judge pick one. Real success of the pick: {pct(bo("1"))} with 1 attempt, {pct(bo("4"))} with 4, {pct(bo("8"))} with 8. A perfect picker would reach {pct(sol?.best_of_n?.["8"]?.oracle)}. The judge, not the agent, is the ceiling.</p></div>
          <div>{sc && <GoodhartChart judges={gh} height={230} />}
            <p className="small muted"><b>More optimisation.</b> Solid line: how often the judge's pick is actually right. Dashed: how highly the judge rates it. Add attacked candidates and the judge gets <i>happier</i> while the picks get <i>worse</i>.</p></div>
        </div>
        <Takeaway>Optimising against the judge works until it doesn't: past a point the judge's score goes up while the real quality of what it picks goes down. That is what happens to an agent trained on this score.</Takeaway>
      </section> },

    { key: "gate", note: "Could we rescue it by choosing a passing score carefully? We tuned the cutoff on separate tasks. The tuned cutoff is '2 or more', which lets about 60% of wrong changes through. The strict cutoff '4 or more' rejects about 97% of right changes. No cutoff is both safe and usable.",
      body: <section className="slide">
        <p className="kicker">Part 2 · What we found</p>
        <h2>"Just set a higher bar" does not work</h2>
        <p className="lead">We picked the best passing score on separate tasks, then tested it. Either you let most wrong changes through, or you reject nearly everything right.</p>
        <table className="mini">
          <thead><tr><th>Judge</th><th>Best cutoff found</th><th>Wrong changes let through</th><th>Right changes rejected</th></tr></thead>
          <tbody>
            {[sol, luna].map((j, k) => j && (
              <tr key={k}><td>{name(k === 0 ? "rubric-gpt6.1-sol" : "rubric-gpt6-luna")}</td><td className="num">score ≥ {j.swe_cutoff ?? "–"}</td><td className="num">{pct(j.metrics.swe_false_accept_cal)}</td><td className="num">{pct(j.metrics.swe_false_reject_cal)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="small muted">At the strict cutoff "4 or more", the same judges reject about 97% of changes that actually pass the tests.</p>
        <Takeaway>The score can <b>rank</b> candidates for the same task. It cannot be a pass/fail <b>gate</b>.</Takeaway>
      </section> },

    { key: "defences", note: "Three fixes, same attacks. (1) Run the PR's own tests in a sandbox and tell the judge whether they truly pass only with the change: the judge then gives zero credit to fake tests, but ~45% of the attacker's tests are real tests of the wrong behaviour and carry the rest. (2) Also run those tests against other agents' attempts: a wrong test should pass on none of them. But 60% do, because other agents make the same mistakes; it removes a fifth to a tenth of what is left. (3) Hide description and tests: nothing to attack, but the judge already approves wrong changes far more often. Ranking quality is unchanged at every step.",
      body: <section className="slide">
        <p className="kicker">Part 3 · Can it be fixed?</p>
        <h2>Three obvious fixes. Each removes some of the attack, none removes half.</h2>
        {modelPicker}
        {sc && <Ladder J={J} model={model} />}
        <Takeaway>Running the tests catches fake tests. Checking other agents catches some wrong tests. But a test of <i>what the patch does</i> looks identical, when run, to a test of <i>what the task needs</i>, and other agents make the same mistakes. <b>The fix has to be tests nobody involved wrote.</b></Takeaway>
        <More>Bars 3 and 4 replay attacks that were tuned against the previous judge, so they understate an attacker that adapts. The judge's ability to rank right above wrong is unchanged by every fix (within 0.03).</More>
      </section> },

    { key: "channels", note: "Which part of the pull request should the judge read? Hide channels from the prompt and re-run. Code only ranks as well as the full judge, so description and tests add no ranking signal. But the test file is where the attack lives (78–88% of the effect) and also the only place where test tampering is visible; the description matters little (17–24%). The full judge's low starting rate came from penalising missing tests, which the attacker then supplies.",
      body: <section className="slide">
        <p className="kicker">Part 3 · Can it be fixed?</p>
        <h2>Which part of the pull request matters?</h2>
        <p className="lead">We hid parts of the pull request from the judge and re-ran everything.</p>
        {modelPicker}
        {sc && <Channels J={J} model={model} />}
        <Takeaway>The judge's <b>knowledge</b> comes from the code. The attacker's <b>lever</b> is the test file, which is also the only place where cheating on tests can be seen. You cannot hide it, and you cannot trust it.</Takeaway>
        {consensus?.attacker_fail_corroborated && <More>Cross-agent check (4,428 sandbox runs): {pct(consensus.attacker_fail_corroborated)} of the attacker's real tests on wrong changes also pass on at least one other agent's attempt; {pct(consensus.genuine_pass_corroborated)} of genuine tests from right changes do. Code-only judge catches {pct(J["rubric-code-gpt6.1-sol"]?.metrics.hack_catch_rate)} / {pct(J["rubric-code-gpt6-luna"]?.metrics.hack_catch_rate)} of scripted test tampering vs {pct(sol?.metrics.hack_catch_rate)} / {pct(luna?.metrics.hack_catch_rate)} for the full judge: all 201 scripted hacks live in test files.</More>}
      </section> },

    { key: "preds", note: "Why believe this? Every experiment had its predictions, with numeric thresholds, written and committed before the run; the test set is reported once. Predictions about judge behaviour mostly came true; predictions that a fix would work mostly did not, each time because an assumption about the attack was wrong. Failed predictions are reported as prominently as successful ones.",
      body: <section className="slide">
        <p className="kicker">Part 4 · Bottom line</p>
        <h2>We said what we expected before every experiment. Here is the scorecard.</h2>
        <p className="lead">Green came true, red did not. Writing them down first is what stops a project from only reporting what worked.</p>
        <Preds />
        <Takeaway>Predictions about how judges <i>behave</i> mostly came true. Predictions that a <i>fix would work</i> mostly did not. The failures are the findings.</Takeaway>
      </section> },

    { key: "end", note: "Close. What this shows: AI code judges carry real signal but can be flipped without changing code; the weakness transfers across judges, compounds under optimisation, cannot be thresholded away, and the standard fixes remove part of it, not half. What it doesn't show: that any judge is safe or best; that passing tests means good code; agreement with human reviewers (we could not show it with the weak labels available). Not run: Devin and Claude under attack; an attacker aware of the consensus check; independently generated tests, which is the next experiment.",
      body: <section className="slide">
        <p className="kicker">Part 4 · Bottom line</p>
        <h2>What this shows, what it doesn't, what's next</h2>
        <div className="cards">
          <div className="card"><h4>Shows</h4>AI code judges know something about right and wrong code, but can be flipped from "reject" to "approve" without a code change. That weakness transfers between judges, gets worse under optimisation, cannot be fixed with a cutoff, and survives the standard fixes.</div>
          <div className="card"><h4>Does not show</h4>That any judge is safe or best. That passing tests means good code. That judges agree with human reviewers: the available human labels were too weak to tell either way.</div>
          <div className="card"><h4>Not yet done</h4>Devin and Claude under attack. An attacker who knows about the cross-agent check. Tests generated from the task <i>before</i> seeing any code, the one fix the results point to.</div>
          <div className="card"><h4>How to use it</h4>As a regression test for anyone choosing or changing a code judge: which judge is more gameable, noisier, or worse at ranking, with error bars. Use the judge to rank; gate on evidence the agent did not write.</div>
        </div>
        <Takeaway>Everyone is optimising against the referee and assuming it is honest. It is honest about 70% of the time, and it can be talked into the rest.</Takeaway>
        <p className="small muted">Full numbers and method: <Link to="/overview">Overview</Link>, <Link to="/findings">Findings</Link>, <Link to="/board">Leaderboard</Link>, <Link to="/play">Fool the judge</Link>, <Link to="/method">Method</Link>.</p>
      </section> },
  ];

  const order = useMemo(() => KEYS.map((_, k) => k).filter((k) => !short || SHORT_KEYS.has(KEYS[k])), [short]);
  const pos = Math.max(0, order.indexOf(i));
  const go = useCallback((d: number) => setI(order[Math.min(order.length - 1, Math.max(0, pos + d))]), [order, pos]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(1); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
      if (e.key === "n" || e.key === "N") setNotes((x) => !x);
      if (e.key === "s" || e.key === "S") { setShort((x) => !x); setI(0); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  const section = SECTION_OF[KEYS[i]];
  const firstOf = (s: number) => order.find((k) => SECTION_OF[KEYS[k]] === s);

  return (
    <div className="demo">
      <div className="section-bar">
        {SECTIONS.map((label, s) => <span key={s} className={s === section ? "on" : ""} onClick={() => { const k = firstOf(s); if (k != null) setI(k); }}>Part {s + 1} · {label}</span>)}
      </div>
      {slides[i].body}
      {notes && <div className="notes"><b>Speaker notes.</b> {slides[i].note}</div>}
      <div className="controls">
        <button className="btn" onClick={() => go(-1)} disabled={pos === 0}>← Back</button>
        <div className="dots">{order.map((k) => <span key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} title={KEYS[k]} />)}</div>
        <span className="small muted">{pos + 1} / {order.length}</span>
        <span className="mode">
          <button className={`btn ${short ? "on" : ""}`} onClick={() => { setShort((x) => !x); setI(0); }}>{short ? "2-minute version" : "full version (10 min)"}</button>{" "}
          <button className={`btn ${notes ? "on" : ""}`} onClick={() => setNotes((x) => !x)}>speaker notes</button>
        </span>
        <button className="btn primary" onClick={() => go(1)} disabled={pos === order.length - 1}>{pos === 0 ? "Start →" : "Next →"}</button>
      </div>
    </div>
  );
}
