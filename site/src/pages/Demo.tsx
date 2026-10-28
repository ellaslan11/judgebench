import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Diff from "../Diff";
import { AttackChart, BestOfNChart, GoodhartChart } from "../charts";
import { useData } from "../data";
import type { Demo as DemoData, DemoAttack, Metric, Scorecard } from "../types";

const NAMES: Record<string, string> = {
  "devin-rubric": "Devin (rubric)",
  "rubric-gpt6.1-sol": "GPT-6.1-sol (rubric)",
  "rubric-gpt6-luna": "GPT-6-luna (rubric)",
  "merge-zs-gpt6.1-sol": "GPT-6.1-sol (zero-shot)",
  "merge-zs-gpt6-luna": "GPT-6-luna (zero-shot)",
  "rubric-haiku4.5": "Claude Haiku 4.5 (rubric)",
  "heuristic-tests": "Line-count heuristic (no LLM)",
  "rubricx-gpt6.1-sol": "GPT-6.1-sol + execution check",
  "rubricx-gpt6-luna": "GPT-6-luna + execution check",
};
const name = (id: string) => NAMES[id] ?? id;
const pct = (m: Metric | undefined) => (m ? `${Math.round(m.value * 100)}%` : "–");
const ci = (m: Metric | undefined) => (m ? `${m.value.toFixed(2)} (${m.lo.toFixed(2)}–${m.hi.toFixed(2)})` : "–");
const cls = (r7: number) => (r7 >= 4 ? "good" : r7 >= 3 ? "mid" : "bad");
const VERDICT: Record<string, string> = {
  verified: "execution check: fails before, passes after the source change",
  vacuous: "execution check: passes even without the source change",
  failing: "execution check: fails with the patch applied",
  empty: "execution check: no runnable tests",
  error: "execution check: could not run",
};

function Attack({ attacks }: { attacks: DemoAttack[] }) {
  const [idx, setIdx] = useState(0);
  const [rnd, setRnd] = useState(0);
  const a = attacks[idx];
  if (!a) return <p className="muted">No cached attack exported yet.</p>;
  const cur = rnd === 0 ? null : a.rounds[rnd - 1];
  const r7 = cur ? cur.r7 : a.before.r7;
  return (
    <div>
      <div className="rounds">
        <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setRnd(0); }}>
          {attacks.map((x, i) => (
            <option key={i} value={i}>{x.target.split("::")[0]} · {name(x.judge)} · {x.before.r7} → {Math.max(...x.rounds.map((r) => r.r7))}</option>
          ))}
        </select>
        <span className="tag bad">hidden tests: FAIL (unchanged throughout)</span>
        <a className="small" href={a.url} target="_blank" rel="noreferrer">issue ↗</a>
      </div>
      <div className="rounds">
        <button className={`btn ${rnd === 0 ? "on" : ""}`} onClick={() => setRnd(0)}>Before attack</button>
        {a.rounds.map((r, i) => (
          <button key={r.round} className={`btn ${rnd === i + 1 ? "on" : ""}`} onClick={() => setRnd(i + 1)}>Round {r.round}</button>
        ))}
        <span style={{ marginLeft: "auto" }}>
          <span className={`score ${cls(r7)}`}>R7 = {r7}</span>{" "}
          <span className="small muted">{r7 >= 4 ? "would merge" : r7 >= 3 ? "needs changes" : "reject"}</span>
        </span>
      </div>
      <p className="reason"><b>{name(a.judge)}:</b> {cur ? cur.reason : a.before.reason}
        {cur?.verdict && <> · <span className={`tag ${cur.verdict === "verified" ? "good" : "bad"}`}>{VERDICT[cur.verdict] ?? cur.verdict}</span></>}
      </p>
      <div className="cols">
        <div className="panel">
          <h4>{cur ? `PR description, rewritten by the attacker (round ${cur.round})` : "PR description, as submitted by the agent"}</h4>
          <pre className="desc">{cur ? cur.description : a.description || "(none)"}</pre>
        </div>
        <div className="panel">
          <h4>{cur ? "Test file added by the attacker. Source hunks: byte-identical" : "Source diff (fails the hidden tests)"}</h4>
          <Diff text={cur ? cur.test_file || "(no new test file this round)" : a.diff} maxLines={200} />
        </div>
      </div>
    </div>
  );
}

export default function Demo() {
  const sc = useData<Scorecard>("scorecard.json");
  const demo = useData<DemoData>("demo.json");
  const [i, setI] = useState(0);
  const J = sc?.judges ?? {};
  const sol = J["rubric-gpt6.1-sol"], luna = J["rubric-gpt6-luna"], solx = J["rubricx-gpt6.1-sol"], lunax = J["rubricx-gpt6-luna"];
  const signal = Object.entries(J)
    .filter(([id, j]) => j.metrics.swe_pair_acc && id in NAMES && !id.startsWith("rubricx-"))
    .sort((a, b) => (b[1].metrics.swe_pair_acc?.value ?? 0) - (a[1].metrics.swe_pair_acc?.value ?? 0));
  const att = Object.entries(J).filter(([id, j]) => j.metrics.attack_gate_rate && !id.startsWith("rubricx-"));
  const attx = Object.entries(J).filter(([id, j]) => j.metrics.attack_gate_rate && id.startsWith("rubricx-"));
  const gh = Object.entries(J).filter(([id, j]) => j.goodhart?.pool_plus_attack_r3 && !id.startsWith("rubricx-"));
  const bo = (n: string) => sol?.best_of_n?.[n]?.judge;
  const attacks = useMemo(() => (demo?.attacks ?? []).filter((a) => a.judge.startsWith("rubric-")).concat((demo?.attacks ?? []).filter((a) => !a.judge.startsWith("rubric-"))), [demo]);

  const slides = [
    <section className="slide" key="q">
      <p className="kicker">JudgeBench-Code · demo</p>
      <h1>Can an LLM judge be trusted to grade code?</h1>
      <p className="lead">
        Devin and every other agent platform use an LLM to judge code: to decide a task is done before opening a PR, to pick
        the best of N attempts, and as a reward signal. We benchmarked the <b>judge</b>, not the agent.
      </p>
      <p className="lead">Use → or space to step through. About 8 minutes.</p>
    </section>,

    <section className="slide" key="signal">
      <h2>1. The judge is real signal</h2>
      <p className="lead">
        751 agent patches on 105 SWE-bench tasks, each labelled by hidden tests the judge never sees. How often does the judge
        rank a passing patch above a failing one on the same task? Held-out tasks, 95% CIs resampling whole repositories.
      </p>
      <table className="mini">
        <thead><tr><th>Judge</th><th>Passing ranked above failing</th></tr></thead>
        <tbody>
          {signal.map(([id, j]) => <tr key={id}><td>{name(id)}</td><td className="num">{ci(j.metrics.swe_pair_acc)}</td></tr>)}
          <tr><td className="muted">Random</td><td className="num muted">0.50</td></tr>
        </tbody>
      </table>
      <p className="lead">Every LLM judge beats chance and the non-LLM heuristic. The top intervals overlap: <b>no winner</b>.</p>
    </section>,

    <section className="slide" key="rules">
      <h2>2. The attack: never touch the code</h2>
      <p className="lead">
        For each of 72 held-out tasks, take the failing agent patch the judge likes best. An attacker model sees the judge's score
        and reasons and gets three rounds. It may <b>only</b> rewrite the PR description and add one test file.
        The source hunks stay byte-identical, so the patch still fails the hidden tests.
      </p>
      <p className="lead">Question: how often does the judge move a failing patch to "would merge" (R7 ≥ 4)?</p>
    </section>,

    <section className="slide" key="live">
      <h2>3. One real attack, replayed from cache</h2>
      {demo ? <Attack attacks={attacks} /> : <p className="muted">loading…</p>}
    </section>,

    <section className="slide" key="agg">
      <h2>4. It works at scale, and it transfers</h2>
      <div className="bigs">
        {att.map(([id, j]) => (
          <div key={id}><div className="big">{pct(j.metrics.attack_gate_before)} → {pct(j.metrics.attack_gate_rate)}</div><div className="stat-l">failing patches at "would merge", before → after attack · {name(id)}</div></div>
        ))}
      </div>
      {sc && <AttackChart judges={att} height={240} />}
      <p className="lead">
        Fair control: give the passing patches the same attacker, and the attacked failing patch still beats every passing patch
        for its task {pct(luna?.metrics.attack_win_fair)}–{pct(sol?.metrics.attack_win_fair)} of the time. Attacks tuned on one judge
        work almost as well on the other, on a blind rubric and zero-shot: <b>structural, not a prompt quirk</b>.
      </p>
    </section>,

    <section className="slide" key="gate">
      <h2>5. You cannot threshold your way out</h2>
      <table className="mini">
        <thead><tr><th>Judge</th><th>Cutoff tuned on dev tasks</th><th>Failing patches let through</th><th>Passing patches rejected</th></tr></thead>
        <tbody>
          {[sol, luna].map((j, k) => j && (
            <tr key={k}><td>{name(k === 0 ? "rubric-gpt6.1-sol" : "rubric-gpt6-luna")}</td><td className="num">R7 ≥ {j.swe_cutoff ?? "–"}</td><td className="num">{pct(j.metrics.swe_false_accept_cal)}</td><td className="num">{pct(j.metrics.swe_false_reject_cal)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="lead">
        At the strict cutoff "4 or more", the same judges reject about 97% of patches that pass the hidden tests. Either you block
        nearly everything good or you let most of the bad through. <b>No cutoff is both safe and usable.</b> The score can rank; it cannot gate.
      </p>
    </section>,

    <section className="slide" key="bon">
      <h2>6. Best-of-N plateaus at N ≈ 4</h2>
      <div className="bigs">
        <div><div className="big">{pct(bo("1"))} → {pct(bo("4"))} → {pct(bo("8"))}</div><div className="stat-l">pass rate of the judge's pick at N = 1, 4, 8 candidates · GPT-6.1-sol rubric. An oracle reaches {pct(sol?.best_of_n?.["8"]?.oracle)}.</div></div>
      </div>
      {sc && <BestOfNChart judges={(["rubric-gpt6.1-sol", "rubric-gpt6-luna"] as const).filter((id) => J[id]).map((id) => [id, J[id]] as const)} height={260} />}
      <p className="lead">Running more attempts stops helping after four. The judge, not the agent, is the bottleneck.</p>
    </section>,

    <section className="slide" key="gh">
      <h2>7. Optimise against the judge and the code gets worse</h2>
      {sc && <GoodhartChart judges={gh} height={300} />}
      <p className="lead">
        Solid: true pass rate of whatever the judge picks. Dashed: the judge's score of it. As the candidate set grows from one
        patch to the whole pool and then adds attacked patches, the score keeps climbing while the pass rate turns down.
        A <b>Goodhart curve</b> for code judges.
      </p>
    </section>,

    <section className="slide" key="fix">
      <h2>8. The fix, and its limit</h2>
      <p className="lead">
        Run the PR's own tests in the SWE-bench container without and with the source change, and tell the judge whether they
        genuinely fail-to-pass. The verified judge gives zero credit to tests flagged failing or vacuous: the decorative-test exploit is gone.
      </p>
      <div className="bigs">
        {attx.map(([id, j]) => (
          <div key={id}><div className="big">{pct(J[id.replace("rubricx-", "rubric-")]?.metrics.attack_gate_rate)} → {pct(j.metrics.attack_gate_rate)}</div><div className="stat-l">attack success, unverified → execution-checked · {name(id)}</div></div>
        ))}
        <div><div className="big">{pct(solx?.metrics.attack_tests_verified_share ?? lunax?.metrics.attack_tests_verified_share)}</div><div className="stat-l">of attacker-written tests genuinely fail before and pass after the <i>wrong</i> patch. They carry all the remaining attack.</div></div>
      </div>
      <p className="lead">
        A test of what the patch does is indistinguishable, by execution alone, from a test of what the issue needs.
        <b> You need tests the agent did not write.</b>
      </p>
    </section>,

    <section className="slide" key="end">
      <h2>9. What this does and does not show</h2>
      <ul className="caveats">
        <li><b>Shows:</b> LLM judges beat chance on whether tests pass; the signal lives in the channels the agent controls; the exploit transfers, compounds under optimisation, and no threshold makes the score a gate.</li>
        <li><b>Does not show:</b> that any judge is "best" or safe; that execution-checking the agent's own tests makes a judge safe; that passing hidden tests means good code.</li>
        <li><b>Caveats:</b> public data may be in training sets; one attacker model, three rounds; Devin and Haiku were not run in the attack or verified settings; human-label datasets are weak proxies.</li>
        <li><b>Use it as:</b> a regression suite for whoever picks or changes a code judge, with pre-registered metrics and repo-clustered error bars. Gate on execution evidence the agent did not produce; use the judge to rank.</li>
      </ul>
      <p className="lead">
        Full numbers: <Link to="/overview">Overview</Link>, <Link to="/findings">Findings</Link>, <Link to="/board">Leaderboard</Link>, <Link to="/method">Method</Link>.
      </p>
    </section>,
  ];

  const n = slides.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "SELECT") return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); setI((x) => Math.min(n - 1, x + 1)); }
      if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n]);

  return (
    <div className="demo">
      {slides[i]}
      <div className="controls">
        <button className="btn" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>← Back</button>
        <div className="dots">{slides.map((_, k) => <span key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} />)}</div>
        <span className="small muted">{i + 1} / {n}</span>
        <button className="btn primary" onClick={() => setI(Math.min(n - 1, i + 1))} disabled={i === n - 1}>{i === 0 ? "Start →" : "Next →"}</button>
      </div>
    </div>
  );
}
