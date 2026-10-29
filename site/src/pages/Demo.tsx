import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Diff from "../Diff";
import { AttackChart, BestOfNChart, DefenceChart, GoodhartChart } from "../charts";
import { useData } from "../data";
import { PREDICTIONS } from "../predictions";
import type { Demo as DemoData, DemoAttack, JudgeCard, Metric, Scorecard } from "../types";

const NAMES: Record<string, string> = {
  "devin-rubric": "Devin", "rubric-gpt6.1-sol": "GPT-6.1-sol", "rubric-gpt6-luna": "GPT-6-luna",
  "merge-zs-gpt6.1-sol": "GPT-6.1-sol (simpler prompt)", "merge-zs-gpt6-luna": "GPT-6-luna (simpler prompt)",
  "rubric-haiku4.5": "Claude Haiku 4.5", "heuristic-tests": "No AI: count the lines",
  "rubricx-gpt6.1-sol": "GPT-6.1-sol + runs the tests", "rubricx-gpt6-luna": "GPT-6-luna + runs the tests",
  "rubricxc-gpt6.1-sol": "GPT-6.1-sol + tests + other agents", "rubricxc-gpt6-luna": "GPT-6-luna + tests + other agents",
};
const MODELS = [["gpt6-luna", "GPT-6-luna"], ["gpt6.1-sol", "GPT-6.1-sol"]] as const;
const PARTS = ["The setup", "What we found", "Can it be fixed?", "Bottom line"];
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
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ---- small presentational helpers ---- */
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
        <span className="tag bad">the code still fails the project's tests</span>
        <a className="small" href={a.url} target="_blank" rel="noreferrer">bug report ↗</a>
      </div>
      <div className="rounds">
        <button className={`btn ${rnd === 0 ? "on" : ""}`} onClick={() => onBeat(0)}>Before the attack</button>
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
          <h4>{cur ? "The test file the attacker added. The code itself is untouched." : "The code change. This is what fails the tests."}</h4>
          <Diff text={cur ? cur.test_file || "(no new test file this round)" : a.diff} maxLines={60} />
        </div>
      </div>
    </div>
  );
}

function Ladder({ J, model }: { J: Record<string, JudgeCard>; model: string }) {
  const full = J[`rubric-${model}`], x = J[`rubricx-${model}`], xc = J[`rubricxc-${model}`], code = J[`rubric-code-${model}`];
  const steps = [
    { label: "plain judge", g: gate(full, true), what: "reads the description, the code and the tests", left: "a persuasive description plus a decorative test" },
    { label: "+ run the PR's tests", g: gate(x, true), what: "we run the pull request's own tests in a sandbox and tell the judge whether they truly pass only with the change", left: "attacker tests that truly pass only with the wrong change, about 45% of them" },
    { label: "+ check other agents", g: gate(xc, false), what: "we also run those tests against other agents' attempts at the same bug", left: "wrong tests that other agents' wrong attempts also pass, 60% of them" },
    { label: "hide description + tests", g: gate(code, false), what: "the judge sees only the code", left: "nothing to attack, but it already approves the untouched broken fix far more often" },
  ];
  return (
    <div>
      <DefenceChart steps={steps.map((s) => ({ label: s.label, before: s.g[0] ?? null, after: s.g[1] ?? null }))} height={210} />
      <div className="ladder">
        {steps.map((s) => (
          <div className="cell" key={s.label}>
            <h4>{s.label}</h4>
            <div className="big">{pctv(s.g[0])} → {pctv(s.g[1])}</div>
            <div className="small muted">broken fixes approved, before and after the attack. {s.what}.</div>
            <div className="small" style={{ marginTop: 6 }}><b>What the attacker still has:</b> {s.left}</div>
          </div>
        ))}
      </div>
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
  const sol = J["rubric-gpt6.1-sol"], luna = J["rubric-gpt6-luna"];
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
    { key: "title", part: 0, title: "Can the grader be trusted?", dur: 8, short: true, note: "This is a research side project on automatic evaluation. Every agent pipeline has an AI somewhere deciding whether code is good enough. I measured how much that grader actually knows, how easily it can be fooled, and whether the usual fixes work.",
      body: () => <>
        <p className="kicker">JudgeBench-Code</p>
        <h1>AI writes the code. Another AI grades it.<br />Can we trust the grader?</h1>
        <p className="lead">We tested the <b>grader</b>, not the coder, on 751 real code changes written by AI coding agents. Each change has a known right answer. The grader knows something, but it can be talked into approving broken code <b>without a single line of code changing</b>. The obvious fixes only get you halfway.</p>
      </> },

    { key: "setup", part: 0, title: "The setup", dur: 24, short: true, note: "A real bug report comes in. A coding agent writes a pull request. A second model, the judge, reads it and scores it from one to five. Four or five means it would be merged. That score ends tasks, picks between attempts, and trains agents. Our answer key is the hidden tests written by the project maintainers. The judge never sees them.",
      body: ({ cap }) => <>
        <p className="kicker">Part 1 · The setup</p>
        <h2>Who writes the code, who grades it, and how we know who was right</h2>
        <div className="pipeline">
          <div className="node"><span className="n">1</span><h4>A real bug</h4><p>A bug report from a real open-source project, for example "requests crashes when the method name is bytes".</p></div>
          <div className="node"><span className="n">2</span><h4>An AI coding agent</h4><p>Reads the bug and writes a pull request: a code change, a description, and sometimes tests.</p></div>
          <div className="node hot"><span className="n">3</span><h4>An AI judge</h4><p>A second model reads the pull request and scores it from <b>1 to 5</b>. A 4 or 5 means <b>"would merge"</b>. This is what we test.</p><Scale /></div>
          <div className="node"><span className="n">4</span><h4>The answer key</h4><p>The project's own hidden tests. The judge never sees them. If the change passes, it is right. If it fails, it is wrong.</p></div>
        </div>
        <Caption show={cap}>751 real changes from 30+ coding agents on 105 real bugs, each with a known right answer. Everything that follows is measured against that answer key.</Caption>
      </> },

    { key: "signal", part: 1, title: "The judges know something", dur: 18, note: "First the good news. Give a judge a right fix and a wrong fix for the same bug. It picks the right one about seven times out of ten. A coin flip gets five. The top three judges are tied, so this benchmark does not crown a winner.",
      body: ({ cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>The judges know something</h2>
        <p className="lead">Show a judge a right fix and a wrong fix for the same bug. How often does the right one get the higher score?</p>
        <table className="mini"><thead><tr><th>Judge</th><th>Right fix scored higher</th></tr></thead>
          <tbody>{signal.map(([id, j]) => <tr key={id}><td>{name(id)}</td><td className="num">{pct(j.metrics.swe_pair_acc)}</td></tr>)}<tr><td className="muted">Coin flip</td><td className="num muted">50%</td></tr></tbody></table>
        <Caption show={cap}>About seven times out of ten. Better than chance, but the top three judges are tied, so there is <b>no winner</b>.</Caption>
        <More><table className="mini"><tbody>{signal.map(([id, j]) => <tr key={id}><td>{id}</td><td className="num">{ci(j.metrics.swe_pair_acc)}</td></tr>)}</tbody></table>72 held-out bugs from 11 projects. Ties count as half. The 95% intervals resample whole projects.</More>
      </> },

    { key: "live", part: 1, title: "Watch a broken fix get approved", dur: 55, beats: 4, short: true, note: "Here is the main result in one example. Before the attack the judge scores this broken fix a two and rejects it. Then an attacker model gets three tries. It is only allowed to rewrite the description and add one test file. It cannot touch the code, so the fix stays broken. Watch the score. After one round the judge says it would merge. The code on the right never changed.",
      body: ({ beat, setBeat, playing, cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>Watch a broken fix get approved without changing the code</h2>
        <p className="lead">An attacker model gets three tries. It may rewrite the description and add one test file. It may <b>not</b> touch the code, so the fix stays broken.</p>
        {demo ? <Attack attacks={attacks} beat={beat} onBeat={setBeat} playing={playing} /> : <p className="muted">loading…</p>}
        <Caption show={cap}>Same broken code. New words and one test file. The verdict flips to "would merge". The judge was grading the <b>story</b>, not the code.</Caption>
      </> },

    { key: "agg", part: 1, title: "It works almost everywhere", dur: 24, note: `We ran that attack on ${nAttacked} bugs. Broken fixes approved went from ${pct(sol?.metrics.attack_gate_before)} to ${pct(sol?.metrics.attack_gate_rate)} on GPT-6.1-sol, and from ${pct(luna?.metrics.attack_gate_before)} to ${pct(luna?.metrics.attack_gate_rate)} on GPT-6-luna. Attacks built against one judge also work on the other. This is a property of the approach, not a quirk of one model.`,
      body: ({ cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>It works on most bugs, and on other judges</h2>
        <div className="bigs">
          {att.map(([id, j]) => <div key={id}><div className="big">{pct(j.metrics.attack_gate_before)} → <CountUp to={j.metrics.attack_gate_rate?.value} /></div><div className="stat-l">broken fixes approved, before and after the attack · {name(id)}</div></div>)}
        </div>
        {sc && <AttackChart judges={att} height={170} />}
        <Caption show={cap}>Attacks built against one judge also fool the other. Even when the right fixes get the same attacker, the broken one still wins {pct(luna?.metrics.attack_win_fair)} to {pct(sol?.metrics.attack_win_fair)} of the time.</Caption>
        <More>Attacks tuned on GPT-6-luna and replayed on GPT-6.1-sol: {pct(sol?.metrics.attack_gate_xfer_before)} → {pct(sol?.metrics.attack_gate_xfer)}. The reverse: {pct(luna?.metrics.attack_gate_xfer_before)} → {pct(luna?.metrics.attack_gate_xfer)}. They also work on a blind rubric and a plain zero-shot prompt. Devin and Claude were not run under attack.</More>
      </> },

    { key: "opt", part: 1, title: "Leaning on the judge makes things worse", dur: 30, note: `Two ways people lean on the judge. Let the agent try several times and let the judge pick. The pick is right ${pct(bo("1"))} of the time with one attempt and ${pct(bo("4"))} with four. Then it stops improving. A perfect picker would reach ${pct(sol?.best_of_n?.["8"]?.oracle)}. Now keep optimising against the judge. Add more candidates, including attacked ones. The judge's score of its favourite keeps rising while that favourite is right less and less often. That is what happens to an agent trained on this score. And you cannot fix it with a threshold. The best cutoff still lets about 60% of broken fixes through.`,
      body: ({ cap }) => <>
        <p className="kicker">Part 2 · What we found</p>
        <h2>The more you lean on the judge, the worse it gets</h2>
        <div className="cols">
          <div>{sc && <BestOfNChart judges={(["rubric-gpt6.1-sol", "rubric-gpt6-luna"] as const).filter((id) => J[id]).map((id) => [id, J[id]] as const)} height={200} />}
            <p className="small muted"><b>Let the judge pick the best of several attempts.</b> The pick is right {pct(bo("1"))} of the time with one attempt and {pct(bo("4"))} with four. Then it stops improving. A perfect picker would reach {pct(sol?.best_of_n?.["8"]?.oracle)}.</p></div>
          <div>{sc && <GoodhartChart judges={gh} height={200} />}
            <p className="small muted"><b>Keep optimising against the judge.</b> Solid line: how often its favourite is actually right. Dashed line: how much the judge likes it. Add attacked candidates and the judge gets happier while its picks get worse.</p></div>
        </div>
        <Caption show={cap}>Past a point, a higher score means worse code. A threshold does not save you either. The best cutoff still lets about {pct(luna?.metrics.swe_false_accept_cal)} of broken fixes through.</Caption>
      </> },

    { key: "defences", part: 2, title: "Three fixes", dur: 50, short: true, note: "We tested the three obvious fixes against the same attacks. First, actually run the pull request's tests in a sandbox and tell the judge whether they really pass only with the change. That kills fake tests, and the attack drops from 61 to 42 percent. But almost half of the attacker's tests are real tests of the wrong behaviour, and those still get through. Second, also run those tests against other agents' attempts at the same bug. A test of wrong behaviour should fail on everyone else. It drops to 33 percent, because 60 percent of the time other agents made the same mistake. Third, hide the description and tests from the judge. Nothing left to attack, but now it approves the untouched broken fix 47 percent of the time. Every fix helps a bit. None gets halfway.",
      body: ({ cap }) => <>
        <p className="kicker">Part 3 · Can it be fixed?</p>
        <h2>Three obvious fixes. Each helps a little. None gets halfway.</h2>
        {modelPicker}
        {sc && <Ladder J={J} model={model} />}
        <Caption show={cap}>A test of what the code <i>does</i> looks exactly like a test of what the bug <i>needs</i>, once you run it. And other agents make the same mistakes. <b>The only fix left is tests that nobody involved wrote.</b></Caption>
        <More>Judges keep their ranking ability through every fix (within 0.03). Hiding the test file also blinds the judge to test tampering: it catches 3% to 15% of deleted or gutted tests instead of 85% to 91%, because every such hack lives in a test file. The two right-hand bars replay attacks tuned against the previous judge, so an attacker who adapts would do at least this well.{consensus?.attacker_fail_corroborated && <> Cross-agent check: 4,428 sandbox runs. {pct(consensus.attacker_fail_corroborated)} of the attacker's real tests on broken fixes also pass on another agent's attempt.</>}</More>
      </> },

    { key: "preds", part: 3, title: "We called it in advance", dur: 26, note: "Why believe this? Before every experiment I wrote down what I expected, as a number, and committed it to the repo. Ten of those predictions came true. Nine did not. One could not be tested as written. The ones about how judges behave mostly held. The ones that said a fix would work mostly failed, each time because I had assumed something about the attack that turned out to be false. The failures are the findings.",
      body: ({ cap }) => <>
        <p className="kicker">Part 4 · Bottom line</p>
        <h2>We wrote down what we expected before every experiment</h2>
        <p className="lead">21 predictions, each with a number, committed before the run. Green came true. Red did not.</p>
        <Preds />
        <Caption show={cap}>Predictions about how judges <i>behave</i> mostly came true. Predictions that a <i>fix would work</i> mostly did not. The failures are the findings.</Caption>
      </> },

    { key: "end", part: 3, title: "What this means", dur: 30, short: true, note: "What this shows. AI code judges know something, but they can be flipped from reject to approve without the code changing. That weakness transfers between judges, gets worse the harder you optimise, cannot be fixed with a cutoff, and survives the standard fixes. What it does not show. That any judge is safe, or that passing tests means good code. What comes next is the one fix the results point to: tests generated from the bug report before any code exists. The rule for anyone using an AI grader is simple. Use it to rank. Never let it be the gate unless the evidence comes from somewhere the graded party cannot touch.",
      body: ({ cap }) => <>
        <p className="kicker">Part 4 · Bottom line</p>
        <h2>What this means</h2>
        <div className="grid2">
          <div className="cell"><h4>What we showed</h4>AI code judges know something about right and wrong code. But they can be flipped from "reject" to "approve" without the code changing. That weakness carries over between judges, gets worse the harder you optimise, cannot be fixed with a cutoff, and survives the standard fixes.</div>
          <div className="cell"><h4>What we did not show</h4>That any judge is safe or the best. That passing tests means good code. That judges agree with human reviewers. The human labels we could find were too weak to tell either way.</div>
          <div className="cell"><h4>What comes next</h4>Tests generated from the bug report before any code exists. It is the one fix these results point to. Also Devin and Claude under attack, and an attacker that adapts to the fixes.</div>
          <div className="cell"><h4>The rule</h4>Use an AI judge to rank. Do not let it be the gate unless the evidence comes from somewhere the graded party cannot touch.</div>
        </div>
        <Caption show={cap}>Everyone is optimising against the referee and assuming it is honest. It is honest about seven times out of ten. The rest of the time, it can be talked into anything.</Caption>
        <p className="small muted" style={{ marginTop: 10 }}>All numbers and methods: <Link to="/overview">Overview</Link>, <Link to="/findings">Findings</Link>, <Link to="/board">Leaderboard</Link>, <Link to="/play">Fool the judge</Link>, <Link to="/method">Method</Link>.</p>
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
        <button className={`btn ${short ? "on" : ""}`} onClick={() => { setShort((x) => !x); goTo(0); }}>{short ? "2-minute cut" : "full cut (5 min)"}</button>
        <button className={`btn ${notes ? "on" : ""}`} onClick={() => setNotes((x) => !x)}>notes</button>
      </div>
      <p className="hint">Space plays and pauses. Arrow keys step. Click the timeline to jump. N shows speaker notes. S switches to the two-minute cut. Everything on screen stays clickable while paused.</p>
    </div>
  );
}
