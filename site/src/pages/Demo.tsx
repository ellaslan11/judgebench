import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Diff from "../Diff";
import { DefenceChart, GoodhartChart } from "../charts";
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
const PARTS = ["The attack", "The study", "What we found", "Can it be fixed?", "Bottom line"];
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
const Caption = ({ show, children }: { show: boolean; children: ReactNode }) => (show ? <div className="caption"><span className="lbl">Takeaway</span>{children}</div> : <div style={{ height: 70 }} />);
const More = ({ title = "Details and exact numbers", children }: { title?: string; children: ReactNode }) => <details className="more"><summary>{title}</summary>{children}</details>;
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

  const share = (j: JudgeCard | undefined, full: JudgeCard | undefined) => { const l = lift(j, false), f = lift(full, true); return l == null || !f ? "–" : `${Math.round((l / f) * 100)}%`; };
  const mSol = { full: sol, code: J["rubric-code-gpt6.1-sol"], tests: J["rubric-codetests-gpt6.1-sol"], desc: J["rubric-codedesc-gpt6.1-sol"] };
  const mLuna = { full: luna, code: J["rubric-code-gpt6-luna"], tests: J["rubric-codetests-gpt6-luna"], desc: J["rubric-codedesc-gpt6-luna"] };
  const scenes: Scene[] = [
    { key: "live", part: 0, title: "A broken fix gets approved", dur: 32, beats: 4, short: true, note: "Start here, no preamble. This is a real pull request from an AI coding agent. The code change is broken: it fails the project's own tests. The judge, another AI, scores it a two and rejects it. Now an attacker model gets three tries. It may only rewrite the description and add one test file. It cannot touch the code. Watch the score. One round later the judge says it would merge. The code on the right never changed.",
      body: ({ beat, setBeat, playing, cap }) => <>
        <p className="kicker">JudgeBench-Code</p>
        <h2>A broken fix gets approved, and not one line of code changed</h2>
        <p className="lead">An AI coding agent wrote this fix. It fails the project's tests. An AI judge rejected it. Then an attacker rewrote the description and added one test file. It never touched the code.</p>
        {demo ? <Attack attacks={attacks} beat={beat} onBeat={setBeat} playing={playing} /> : <p className="muted">loading…</p>}
        <Caption show={cap}>Same broken code. New words and one test file. The judge flips to "would merge". It was grading the <b>story</b>, not the code.</Caption>
      </> },

    { key: "thesis", part: 1, title: "What we found, and how", dur: 40, short: true, note: "That is the project in one example. The claim it leads to: the part of an AI code judge that can be gamed is the part that reads what the agent wrote about its own code, the description and the tests. Every fix that checks that same material fails for the same reason. To show it, we built a benchmark of the grader, not the coder. 751 real changes from more than thirty agents on 105 real bugs, each with the project's hidden tests as the answer key. An attacker that may never touch the code. And before every experiment, a numeric prediction committed to the repo, so the results could not be chosen after the fact.",
      body: ({ cap }) => <>
        <p className="kicker">Part 2 · The study</p>
        <h1>The part of an AI code judge that can be gamed is the part that reads what the agent said about its own code.</h1>
        <p className="lead">Agent platforms use an AI judge to end tasks, choose between attempts, and reward agents in training. We measured how much that judge knows, how cheaply it can be fooled, and whether the standard fixes work.</p>
        <div className="grid2" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div className="cell"><h4>Ground truth</h4><b>751</b> real changes from 30+ coding agents on <b>105</b> real bugs. The answer key is the project's own hidden tests, which the judge never sees.</div>
          <div className="cell"><h4>An adversary</h4>An attacker model that may rewrite the description and add one test file, with three tries and the judge's feedback. It can never touch the code.</div>
          <div className="cell"><h4>Rigor</h4><b>21</b> numeric predictions committed before the runs. Error bars that resample whole projects. Fair controls. <b>4,428</b> sandbox runs in the real containers.</div>
        </div>
        <Caption show={cap}>Every number in this deck had a prediction written down before the experiment ran. The ones that failed are reported as loudly as the ones that held.</Caption>
      </> },

    { key: "signal", part: 2, title: "The judges know something", dur: 16, note: "First, to be fair to the judges. Show one a right fix and a wrong fix for the same bug, and it picks the right one about seven times out of ten. A coin flip gets five. Devin, GPT-6.1-sol and GPT-6-luna are tied. So the weakness you are about to see is not one bad model. It is shared by every judge we tested.",
      body: ({ cap }) => <>
        <p className="kicker">Part 3 · What we found</p>
        <h2>The judges do know something</h2>
        <p className="lead">Show a judge a right fix and a wrong fix for the same bug. How often does the right one get the higher score?</p>
        <table className="mini"><thead><tr><th>Judge</th><th>Right fix scored higher</th></tr></thead>
          <tbody>{signal.map(([id, j]) => <tr key={id}><td>{name(id)}</td><td className="num">{pct(j.metrics.swe_pair_acc)}</td></tr>)}<tr><td className="muted">Coin flip</td><td className="num muted">50%</td></tr></tbody></table>
        <Caption show={cap}>About seven times out of ten, and the top three are tied. The weakness that follows is <b>shared by every judge we tested</b>, not a flaw of one model.</Caption>
        <More><table className="mini"><tbody>{signal.map(([id, j]) => <tr key={id}><td>{id}</td><td className="num">{ci(j.metrics.swe_pair_acc)}</td></tr>)}</tbody></table>72 held-out bugs from 11 projects. Ties count as half. The 95% intervals resample whole projects.</More>
      </> },

    { key: "scale", part: 2, title: "It works almost everywhere, and it compounds", dur: 60, note: `We ran the attack on ${nAttacked} bugs. Broken fixes approved went from ${pct(sol?.metrics.attack_gate_before)} to ${pct(sol?.metrics.attack_gate_rate)} on GPT-6.1-sol and from ${pct(luna?.metrics.attack_gate_before)} to ${pct(luna?.metrics.attack_gate_rate)} on GPT-6-luna. To be fair we gave the right fixes the same attacker, and the broken one still won about a quarter of the time. Attacks built against one judge fool the other. Then the compounding part. Let the agent try several times and let the judge pick: it helps up to about four attempts and then stops. Keep optimising against the judge, add attacked candidates, and the judge's score of its favourite keeps rising while that favourite is right less and less often. That is what happens to an agent trained on this score. And a threshold does not save you. The best cutoff still lets about 60 percent of broken fixes through.`,
      body: ({ cap }) => <>
        <p className="kicker">Part 3 · What we found</p>
        <h2>It works on most bugs, on other judges, and it gets worse the harder you optimise</h2>
        <div className="cols">
          <div>
            <div className="bigs" style={{ gridTemplateColumns: "1fr 1fr", margin: "6px 0 10px" }}>
              {att.map(([id, j]) => <div key={id}><div className="big" style={{ fontSize: 40 }}>{pct(j.metrics.attack_gate_before)} → <CountUp to={j.metrics.attack_gate_rate?.value} /></div><div className="stat-l">broken fixes approved, before and after the attack · {name(id)}</div></div>)}
            </div>
            <p className="small muted">Attacks built against one judge also fool the other. When the right fixes get the same attacker, the broken one still wins {pct(luna?.metrics.attack_win_fair)} to {pct(sol?.metrics.attack_win_fair)} of the time.</p>
          </div>
          <div>{sc && <GoodhartChart judges={gh} height={210} />}
            <p className="small muted"><b>Optimising against the judge.</b> Solid: how often its favourite is actually right. Dashed: how much the judge likes it. Picking the best of several attempts helps up to about four, then stops. Add attacked candidates and the judge gets happier while its picks get worse.</p></div>
        </div>
        <Caption show={cap}>Past a point, a higher score means worse code. A threshold does not save you either: the best cutoff still lets about {pct(luna?.metrics.swe_false_accept_cal)} of broken fixes through.</Caption>
        <More>Transfer: attacks tuned on GPT-6-luna replayed on GPT-6.1-sol, {pct(sol?.metrics.attack_gate_xfer_before)} → {pct(sol?.metrics.attack_gate_xfer)}; the reverse, {pct(luna?.metrics.attack_gate_xfer_before)} → {pct(luna?.metrics.attack_gate_xfer)}. Best-of-N: the pick is right {pct(bo("1"))} of the time with one attempt, {pct(bo("4"))} with four, {pct(bo("8"))} with eight; a perfect picker would reach {pct(sol?.best_of_n?.["8"]?.oracle)}. Strict cutoff "4 or more" rejects about 97% of right fixes. Devin and Claude were not run under attack.</More>
      </> },

    { key: "defences", part: 3, title: "Three fixes, and why they fail", dur: 60, short: true, note: "We tested the three obvious fixes against the same attacks. Run the pull request's tests for real and tell the judge: fake tests die, and the attack drops from 61 to 42 percent. But almost half the attacker's tests are real tests of the wrong behaviour, and those still get through. Also run them against other agents' attempts, since a wrong test should fail on everyone else: 33 percent, because 60 percent of the time the other agents made the same mistake. Hide the description and tests entirely: nothing to attack, but the judge now approves the untouched broken fix 47 percent of the time. Here is the mechanism. The judge's skill at rejecting bad fixes was largely a penalty for missing tests. The attacker supplies a test, and the penalty disappears. The test file carries almost all of the attack, and it is also the only place where tampering can be seen. You can neither hide it nor trust it.",
      body: ({ cap }) => <>
        <p className="kicker">Part 4 · Can it be fixed?</p>
        <h2>Three obvious fixes. Each helps a little. None gets halfway.</h2>
        {modelPicker}
        {sc && <Ladder J={J} model={model} />}
        <div className="grid2" style={{ marginTop: 6 }}>
          <div className="cell"><h4>Why the judge rejected bad fixes in the first place</h4>Mostly because they had <b>no tests</b>. Hide the test file and the plain judge approves the untouched broken fix {pctv(gate(mSol.code, false)[0])} / {pctv(gate(mLuna.code, false)[0])} of the time instead of {pctv(gate(sol, true)[0])} / {pctv(gate(luna, true)[0])} (GPT-6.1-sol / GPT-6-luna). The attacker's one test file removes that penalty.</div>
          <div className="cell"><h4>Where the exploit lives</h4>The test file carries <b>{share(mSol.tests, sol)} / {share(mLuna.tests, luna)}</b> of the attack. The description carries {share(mSol.desc, sol)} / {share(mLuna.desc, luna)}. Yet a judge shown only the code ranks right above wrong as well as the full judge, and sees none of the test tampering.</div>
        </div>
        <Caption show={cap}>A test of what the code <i>does</i> looks exactly like a test of what the bug <i>needs</i>, once you run it. And other agents make the same mistakes. <b>The only fix left is tests that nobody involved wrote.</b></Caption>
        <More>Judges keep their ranking ability through every fix (within 0.03). A code-only judge catches {pct(mSol.code?.metrics.hack_catch_rate)} / {pct(mLuna.code?.metrics.hack_catch_rate)} of deleted or gutted tests instead of {pct(sol?.metrics.hack_catch_rate)} / {pct(luna?.metrics.hack_catch_rate)}, because every such hack lives in a test file. The two right-hand bars replay attacks tuned against the previous judge, so an adapting attacker would do at least this well.{consensus?.attacker_fail_corroborated && <> Cross-agent check: 4,428 sandbox runs; {pct(consensus.attacker_fail_corroborated)} of the attacker's real tests on broken fixes also pass on another agent's attempt.</>}</More>
      </> },

    { key: "preds", part: 4, title: "We called it in advance", dur: 22, note: "Why believe this? Before every experiment I wrote down what I expected, as a number, and committed it. Ten predictions came true. Nine did not. One could not be tested as written. The ones about how judges behave mostly held. The ones that said a fix would work mostly failed, each time because I had assumed something about the attack that turned out to be false. The failures are the findings.",
      body: ({ cap }) => <>
        <p className="kicker">Part 5 · Bottom line</p>
        <h2>We wrote down what we expected before every experiment</h2>
        <p className="lead">21 predictions, each with a number, committed before the run. Green came true. Red did not.</p>
        <Preds />
        <Caption show={cap}>Predictions about how judges <i>behave</i> mostly came true. Predictions that a <i>fix would work</i> mostly did not. The failures are the findings.</Caption>
      </> },

    { key: "end", part: 4, title: "What to do about it", dur: 22, short: true, note: "The rule for anyone using an AI grader: use it to rank, never as the gate, unless the evidence comes from somewhere the graded party cannot touch. What comes next is the one fix the results point to, tests generated from the bug report before any code exists. Everyone is optimising against the referee and assuming it is honest. It is honest about seven times out of ten. The rest of the time it can be talked into anything.",
      body: ({ cap }) => <>
        <p className="kicker">Part 5 · Bottom line</p>
        <h2>What to do about it</h2>
        <div className="grid2">
          <div className="cell"><h4>The rule</h4>Use an AI judge to <b>rank</b>. Do not let it be the <b>gate</b> unless the evidence comes from somewhere the graded party cannot touch.</div>
          <div className="cell"><h4>What comes next</h4>Tests generated from the bug report before any code exists. It is the one fix these results point to. Then Devin and Claude under attack, and an attacker that adapts to the fixes.</div>
          <div className="cell"><h4>What we showed</h4>AI code judges know something, but they can be flipped from "reject" to "approve" without the code changing. That carries across judges, grows under optimisation, cannot be fixed with a cutoff, and survives the standard fixes.</div>
          <div className="cell"><h4>What we did not show</h4>That any judge is safe or the best. That passing tests means good code. That judges agree with human reviewers; the human labels available were too weak to tell.</div>
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
        <button className={`btn ${short ? "on" : ""}`} onClick={() => { setShort((x) => !x); goTo(0); }}>{short ? "2-minute cut" : "full cut (4 min)"}</button>
        <button className={`btn ${notes ? "on" : ""}`} onClick={() => setNotes((x) => !x)}>notes</button>
      </div>
      <p className="hint">Space plays and pauses. Arrow keys step. Click the timeline to jump. N shows speaker notes. S switches to the two-minute cut. Everything on screen stays clickable while paused.</p>
    </div>
  );
}
