import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Diff from "../Diff";
import { AttackChart, BestOfNChart, DefenceChart, GoodhartChart } from "../charts";
import { useData } from "../data";
import { PREDICTIONS } from "../predictions";
import type { Demo as DemoData, DemoAttack, DemoHook, DemoRetest, JudgeCard, Metric, Scorecard } from "../types";

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
  "rubricxc-gpt6.1-sol": "GPT-6.1-sol + execution + consensus",
  "rubricxc-gpt6-luna": "GPT-6-luna + execution + consensus",
};
const MODELS = [["gpt6-luna", "GPT-6-luna"], ["gpt6.1-sol", "GPT-6.1-sol"]] as const;
const KEYS = ["hook", "signal", "noise", "live", "agg", "opt", "gate", "defences", "channels", "preds", "end"];
const SHORT_KEYS = new Set(["hook", "live", "defences", "end"]);
const name = (id: string) => NAMES[id] ?? id;
const pct = (m: Metric | undefined) => (m ? `${Math.round(m.value * 100)}%` : "–");
const pctv = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "–" : `${Math.round(v * 100)}%`);
const ci = (m: Metric | undefined) => (m ? `${m.value.toFixed(2)} (${m.lo.toFixed(2)}–${m.hi.toFixed(2)})` : "–");
const cls = (r7: number) => (r7 >= 4 ? "good" : r7 >= 3 ? "mid" : "bad");
const verdictWord = (r7: number) => (r7 >= 4 ? "would merge" : r7 >= 3 ? "needs changes" : "reject");
const VERDICT: Record<string, string> = {
  verified: "execution check: fails before, passes after the source change",
  vacuous: "execution check: passes even without the source change",
  failing: "execution check: fails with the patch applied",
  empty: "execution check: no runnable tests",
  error: "execution check: could not run",
};
/** Attack lift for the judge the attack was tuned on (own metrics) or replayed on (xfer metrics). */
const gate = (j: JudgeCard | undefined, own: boolean) =>
  own ? [j?.metrics.attack_gate_before?.value, j?.metrics.attack_gate_rate?.value] : [j?.metrics.attack_gate_xfer_before?.value, j?.metrics.attack_gate_xfer?.value];
const lift = (j: JudgeCard | undefined, own: boolean) => { const [b, a] = gate(j, own); return b == null || a == null ? null : a - b; };

function Hook({ h }: { h: DemoHook }) {
  return (
    <div>
      <div className="rounds">
        <span className={`score ${cls(h.r7)}`}>R7 = {h.r7}</span>
        <span className="small muted">{verdictWord(h.r7)} · {name(h.judge)}</span>
        <span className="tag bad">hidden tests: FAIL</span>
        <a className="small" href={h.url} target="_blank" rel="noreferrer">{h.repo} ↗</a>
      </div>
      <p className="reason"><b>Judge:</b> {h.reason}</p>
      <div className="cols">
        <div className="panel"><h4>The task (issue text)</h4><pre className="desc">{h.task.slice(0, 1400)}{h.task.length > 1400 ? " …" : ""}</pre></div>
        <div className="panel"><h4>The agent's patch</h4><Diff text={h.diff} maxLines={120} /></div>
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
      <div className="rounds">
        <select value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setK(0); }}>
          {rows.map((x, i) => <option key={i} value={i}>{x.parent} · {name(x.judge)} · scores {x.scores.join(" / ")}</option>)}
        </select>
        <a className="small" href={r.url} target="_blank" rel="noreferrer">PR ↗</a>
      </div>
      <div className="rounds">
        {r.scores.map((_, i) => <button key={i} className={`btn ${k === i ? "on" : ""}`} onClick={() => setK(i)}>Grading {i + 1}</button>)}
        <span style={{ marginLeft: "auto" }}><span className={`score ${cls(r.scores[k])}`}>R7 = {r.scores[k]}</span> <span className="small muted">{verdictWord(r.scores[k])}</span></span>
      </div>
      <p className="reason"><b>{name(r.judge)}:</b> {r.reasons[k]}</p>
      <p className="small muted">Same PR, same prompt, same model, nothing changed between gradings.</p>
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
          <span className="small muted">{verdictWord(r7)}</span>
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

function Ladder({ J, model }: { J: Record<string, JudgeCard>; model: string }) {
  const full = J[`rubric-${model}`], x = J[`rubricx-${model}`], xc = J[`rubricxc-${model}`], code = J[`rubric-code-${model}`];
  const steps = [
    { label: "full judge", g: gate(full, true), what: "sees description, code and tests", left: "everything: a persuasive description plus one decorative test file" },
    { label: "+ execution check", g: gate(x, true), what: "runs the PR's own tests fail→pass in the container", left: "tests that genuinely fail→pass on the wrong patch (~45% of the attacker's)" },
    { label: "+ cross-agent consensus", g: gate(xc, false), what: "also runs those tests on other agents' patches", left: "wrong tests that other agents' wrong patches also pass (60% of them)" },
    { label: "code only", g: gate(code, false), what: "description and tests withheld", left: "nothing to attack, but it already accepts the untouched failing patch" },
  ];
  return (
    <div>
      <DefenceChart steps={steps.map((s) => ({ label: s.label, before: s.g[0] ?? null, after: s.g[1] ?? null }))} height={250} />
      <div className="ladder">
        {steps.map((s) => (
          <div className="cell" key={s.label}>
            <h4>{s.label}</h4>
            <div className="big">{pctv(s.g[0])} → {pctv(s.g[1])}</div>
            <div className="small muted">{s.what}</div>
            <div className="small" style={{ marginTop: 6 }}><b>What remains:</b> {s.left}</div>
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
      <div className="cell"><h4>Code only</h4>
        Ranks passing above failing <b>{ci(code?.metrics.swe_pair_acc)}</b> vs {ci(full?.metrics.swe_pair_acc)} for the full judge.
        Accepts the untouched failing patch <b>{pctv(gate(code, false)[0])}</b> of the time (full: {pctv(gate(full, true)[0])}).
        Catches <b>{pct(code?.metrics.hack_catch_rate)}</b> of scripted test-tampering hacks (full: {pct(full?.metrics.hack_catch_rate)}): they all live in test files it cannot see.</div>
      <div className="cell"><h4>Code + tests</h4>
        Carries <b>{share(tests)}</b> of the full judge's attack lift ({pctv(gate(tests, false)[0])} → {pctv(gate(tests, false)[1])}).
        The test channel is where the exploit lives, and the only place test tampering can be seen.</div>
      <div className="cell"><h4>Code + description</h4>
        Carries <b>{share(desc)}</b> of the attack lift ({pctv(gate(desc, false)[0])} → {pctv(gate(desc, false)[1])}).
        Rewriting the description alone barely moves the judge.</div>
      <div className="cell"><h4>Full PR</h4>
        {pctv(gate(full, true)[0])} → <b>{pctv(gate(full, true)[1])}</b> under attack. Its low baseline acceptance of failing patches was mostly
        a penalty for <i>missing</i> tests, which the attacker's test file removes.</div>
    </div>
  );
}

function Preds() {
  const tally = (s: string) => PREDICTIONS.filter((p) => p.result === s).length;
  return (
    <div>
      <div className="tally">
        <span className="held">{tally("held")} held</span><span className="failed">{tally("failed")} failed</span>
        <span className="ill-posed">{tally("ill-posed")} ill-posed</span>{tally("pending") > 0 && <span className="muted">{tally("pending")} pending</span>}
      </div>
      <div className="preds">
        {PREDICTIONS.map((p) => (
          <div className={`pred ${p.result}`} key={p.id}><span className="pid">{p.id}</span><span>{p.text}<br /><span className="note">{p.result}: {p.note}</span></span></div>
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
    .filter(([id, j]) => j.metrics.swe_pair_acc && id in NAMES && !id.startsWith("rubricx"))
    .sort((a, b) => (b[1].metrics.swe_pair_acc?.value ?? 0) - (a[1].metrics.swe_pair_acc?.value ?? 0));
  const att = Object.entries(J).filter(([id, j]) => j.metrics.attack_gate_rate && !id.startsWith("rubricx"));
  const gh = Object.entries(J).filter(([id, j]) => j.goodhart?.pool_plus_attack_r3 && !id.startsWith("rubricx"));
  const bo = (n: string) => sol?.best_of_n?.[n]?.judge;
  const attacks = useMemo(() => (demo?.attacks ?? []).filter((a) => a.judge.startsWith("rubric-")).concat((demo?.attacks ?? []).filter((a) => !a.judge.startsWith("rubric-"))), [demo]);
  const consensus = sc?.consensus as Record<string, Metric> | undefined;
  const modelPicker = (
    <span className="rounds" style={{ margin: "0 0 8px" }}>
      {MODELS.map(([m, label]) => <button key={m} className={`btn ${model === m ? "on" : ""}`} onClick={() => setModel(m)}>{label}</button>)}
    </span>
  );

  const slides: { key: string; short?: boolean; body: ReactNode; note: string }[] = [
    { key: "hook", short: true, note: `A real held-out patch: the agent's source change fails the task's hidden tests, yet the full GPT-6.1-sol rubric judge rates it ${demo?.hook?.r7 ?? "≥4"}, "would merge". ${demo?.hook?.n_false_accept ?? ""} of 72 failing patches get this on this judge before any attack. Platforms use exactly this score to decide a task is done, to pick among attempts, and as a training reward. The question is not whether agents are good; it is whether the referee is.`,
      body: <section className="slide">
        <p className="kicker">JudgeBench-Code · demo</p>
        <h1>Who checks the checker?</h1>
        <p className="lead">An LLM judge decided this agent patch was ready to merge. The hidden tests say it is wrong. Agent platforms use this score to end tasks, pick among attempts and train agents. We benchmarked the <b>judge</b>.</p>
        {demo?.hook ? <Hook h={demo.hook} /> : <p className="muted">loading…</p>}
        <p className="small muted">Step with → or space. <kbd>N</kbd> speaker notes · <kbd>S</kbd> 90-second version. About 8 minutes.</p>
      </section> },

    { key: "signal", note: "751 agent patches on 105 SWE-bench tasks; 72 held-out tasks from 11 repositories are reported. Label = the task's hidden tests, never shown to the judge. Metric = within a task, share of (pass, fail) pairs where the passing patch scores higher; ties 0.5. CIs resample whole repositories. Devin, GPT-6.1-sol and GPT-6-luna overlap; Haiku is below; the non-LLM heuristic is below chance. Hidden tests are a proxy for correctness, and SWE-bench is public, so some memorisation is possible.",
      body: <section className="slide">
        <h2>1. The judge is real signal</h2>
        <p className="lead">751 agent patches on 105 SWE-bench tasks, each labelled by hidden tests the judge never sees. How often does the judge rank a passing patch above a failing one on the same task?</p>
        <table className="mini">
          <thead><tr><th>Judge</th><th>Passing ranked above failing (95% CI)</th></tr></thead>
          <tbody>
            {signal.map(([id, j]) => <tr key={id}><td>{name(id)}</td><td className="num">{ci(j.metrics.swe_pair_acc)}</td></tr>)}
            <tr><td className="muted">Random</td><td className="num muted">0.50</td></tr>
          </tbody>
        </table>
        <p className="lead">Every LLM judge beats chance and the non-LLM heuristic. The top intervals overlap: <b>no winner</b>.</p>
      </section> },

    { key: "noise", note: `Each of 50 unchanged merged PRs was graded three times. The share of re-grades that come out lower than the first grade is ${pct(luna?.metrics.retest_drop)} for GPT-6-luna and ${pct(sol?.metrics.retest_drop)} for GPT-6.1-sol: that is the rate at which pure noise looks like "the judge caught something". Every catch rate in this project is reported net of it. Separately, padding a diff with comments moves Devin's score by ${devin?.metrics.length_bias ? devin.metrics.length_bias.value.toFixed(1) : "–"} points on a 5-point scale; polished descriptions and renames also move scores.`,
      body: <section className="slide">
        <h2>2. The same PR, graded again</h2>
        {demo?.retest ? <Retest rows={demo.retest} /> : <p className="muted">loading…</p>}
        <div className="bigs">
          <div><div className="big">{pct(luna?.metrics.retest_drop)} / {pct(sol?.metrics.retest_drop)}</div><div className="stat-l">re-grades of an unchanged PR that come out lower · GPT-6-luna / GPT-6.1-sol. Noise that looks like a catch.</div></div>
          <div><div className="big">{devin?.metrics.length_bias ? `${devin.metrics.length_bias.value > 0 ? "+" : ""}${devin.metrics.length_bias.value.toFixed(1)}` : "–"}</div><div className="stat-l">points moved by padding the diff with comments · Devin. Nothing about the code changed.</div></div>
        </div>
        <p className="lead">Before asking whether a judge can be fooled: it already disagrees with itself. Every catch rate below is reported net of this noise.</p>
      </section> },

    { key: "live", short: true, note: "The attack: for each held-out task take the failing agent patch the judge likes best. An attacker model sees the judge's score and reasons and gets three rounds. It may only rewrite the PR description and add one test file; source hunks stay byte-identical, so the hidden-test verdict stays FAIL. Walk the rounds: watch R7 climb, read the attacker's test, notice the source panel never changes. The execution-check tag shows what a container run says about the attacker's test.",
      body: <section className="slide">
        <h2>3. One real attack, replayed from cache</h2>
        <p className="lead">An attacker model may <b>only</b> rewrite the PR description and add one test file. Source hunks stay byte-identical, so the patch still fails the hidden tests. Three rounds, with the judge's reasons as feedback.</p>
        {demo ? <Attack attacks={attacks} /> : <p className="muted">loading…</p>}
      </section> },

    { key: "agg", note: `Across 72 held-out tasks: failing patches at "would merge" go ${pct(sol?.metrics.attack_gate_before)} → ${pct(sol?.metrics.attack_gate_rate)} (GPT-6.1-sol) and ${pct(luna?.metrics.attack_gate_before)} → ${pct(luna?.metrics.attack_gate_rate)} (GPT-6-luna). Fair control: the passing patches get the same attacker, and the attacked failing patch still beats every passing one ${pct(luna?.metrics.attack_win_fair)}–${pct(sol?.metrics.attack_win_fair)} of the time. Attacks tuned on one judge transfer to the other, to a blind rubric and to zero-shot (e.g. 4% → 31% on GPT-6.1-sol with luna-tuned attacks). Shown across two OpenAI models and three prompts, not across vendors.`,
      body: <section className="slide">
        <h2>4. It works at scale, and it transfers</h2>
        <div className="bigs">
          {att.map(([id, j]) => (
            <div key={id}><div className="big">{pct(j.metrics.attack_gate_before)} → {pct(j.metrics.attack_gate_rate)}</div><div className="stat-l">failing patches at "would merge", before → after attack · {name(id)}</div></div>
          ))}
        </div>
        {sc && <AttackChart judges={att} height={220} />}
        <p className="lead">Fair control: attack the passing patches too, and the failing patch still beats every passing one {pct(luna?.metrics.attack_win_fair)}–{pct(sol?.metrics.attack_win_fair)} of the time. Attacks tuned on one judge work on the other, on a blind rubric and zero-shot: <b>structural, not a prompt quirk</b>.</p>
      </section> },

    { key: "opt", note: `Best-of-N: pass rate of the judge's top pick from N candidates, ${pct(bo("1"))} at N=1, ${pct(bo("4"))} at N=4, ${pct(bo("8"))} at N=8 (GPT-6.1-sol); the oracle reaches ${pct(sol?.best_of_n?.["8"]?.oracle)}. Goodhart: as the candidate set grows from one patch to the whole pool and then adds attacked patches, the judge's score of its own pick keeps rising while the pick's true pass rate turns down (sol 0.51 → 0.70 → 0.49; luna 0.51 → 0.61 → 0.31). Past a point, optimising the judge makes the code worse.`,
      body: <section className="slide">
        <h2>5. More attempts stop helping; more optimisation hurts</h2>
        <div className="cols">
          <div>{sc && <BestOfNChart judges={(["rubric-gpt6.1-sol", "rubric-gpt6-luna"] as const).filter((id) => J[id]).map((id) => [id, J[id]] as const)} height={250} />}
            <p className="small muted">Best-of-N: pass rate of the judge's pick. {pct(bo("1"))} → {pct(bo("4"))} → {pct(bo("8"))} at N = 1, 4, 8 (GPT-6.1-sol); oracle {pct(sol?.best_of_n?.["8"]?.oracle)}. Plateau at N ≈ 4.</p></div>
          <div>{sc && <GoodhartChart judges={gh} height={250} />}
            <p className="small muted">Goodhart: solid = true pass rate of the pick, dashed = the judge's score of it. Add attacked candidates and the score climbs while the pass rate falls.</p></div>
        </div>
        <p className="lead">The judge, not the agent, is the bottleneck; and optimising against it eventually selects worse code with a better score.</p>
      </section> },

    { key: "gate", note: "Cutoff tuned on the dev split, reported once on test. Every GPT rubric judge picks R7 ≥ 2, which lets about 60% of failing patches through. The strict cutoff R7 ≥ 4 rejects ~97% of patches that pass the hidden tests. The score can rank candidates within a task; it cannot decide merge/no-merge.",
      body: <section className="slide">
        <h2>6. You cannot threshold your way out</h2>
        <table className="mini">
          <thead><tr><th>Judge</th><th>Cutoff tuned on dev tasks</th><th>Failing patches let through</th><th>Passing patches rejected</th></tr></thead>
          <tbody>
            {[sol, luna].map((j, k) => j && (
              <tr key={k}><td>{name(k === 0 ? "rubric-gpt6.1-sol" : "rubric-gpt6-luna")}</td><td className="num">R7 ≥ {j.swe_cutoff ?? "–"}</td><td className="num">{pct(j.metrics.swe_false_accept_cal)}</td><td className="num">{pct(j.metrics.swe_false_reject_cal)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="lead">At the strict cutoff "4 or more", the same judges reject about 97% of patches that pass the hidden tests. <b>No cutoff is both safe and usable.</b> The score can rank; it cannot gate.</p>
      </section> },

    { key: "defences", short: true, note: "Three defences, same attacks. Execution check: run the PR's own tests fail→pass in the SWE-bench container and tell the judge; it then gives zero credit to tests flagged failing or vacuous (0–1 of ~100), but ~45% of the attacker's tests are genuine fail→pass tests of the wrong behaviour and carry the rest. Consensus: also run those tests on up to six other agents' patches for the task; a test passing on none is 'behaviour unique to this patch'. But 60% of the attacker's wrong tests pass on some other agent's patch too, so this removes about a fifth of what is left, not half. Code-only: nothing to attack, but it accepts the untouched failing patch 31–47% of the time. Consensus and code-only bars replay attacks tuned on the previous judge, so they understate an adaptive attacker. Ranking is unchanged at every step.",
      body: <section className="slide">
        <h2>7. Three defences, one attack</h2>
        {modelPicker}
        {sc && <Ladder J={J} model={model} />}
        <p className="lead">Each defence removes one lever and leaves roughly half the attack. A test of what the patch does is indistinguishable, by execution alone, from a test of what the issue needs; and other agents make the same mistakes. <b>You need tests the agent did not write, and that other agents cannot be wrong about together.</b></p>
      </section> },

    { key: "channels", note: "Same rubric and model, with channels removed from the prompt (not just 'ignored'). Code-only ranks within 0.02 of the full judge, so the description and test channels add almost no ranking signal. The test channel carries 78–88% of the attack lift; the description 17–24%. The full judge's apparently low acceptance of failing patches was largely a penalty for missing tests, which the attacker's test file removes. Code-only cannot see test tampering at all: every scripted hack lives in a test file.",
      body: <section className="slide">
        <h2>8. Where the signal lives, and where the exploit lives</h2>
        {modelPicker}
        {sc && <Channels J={J} model={model} />}
        <p className="lead">The ranking signal lives in the code. The exploit lives in the test channel, which is also the only place test tampering is visible. The description carries little of either.</p>
        {consensus?.attacker_fail_corroborated && <p className="small muted">Cross-agent check (4,428 container runs): {pct(consensus.attacker_fail_corroborated)} of the attacker's genuinely fail→pass tests on failing patches also pass on at least one other agent's patch; {pct(consensus.genuine_pass_corroborated)} of genuine tests from passing patches do.</p>}
      </section> },

    { key: "preds", note: "Every experiment had its predictions written and committed before the run, with a numeric threshold; the test split is reported once. Predictions about the judge's behaviour (ranking, obedience to the execution check, best-of-N) mostly held; predictions that a defence would work mostly failed, each time because an assumption about the attack turned out false: attacker tests are not decorative, and wrong tests are not unique to one agent. The failures are the findings; the pre-registration is what makes them credible.",
      body: <section className="slide">
        <h2>9. 21 predictions, written before the runs</h2>
        <Preds />
        <p className="lead">Predictions about judge <i>behaviour</i> mostly held. Predictions that a <i>defence</i> would work mostly failed, each because an assumption about the attack was wrong. The failures are the findings.</p>
      </section> },

    { key: "end", short: true, note: "Human labels: SWE-PRBench requested-changes AUROC 0.42–0.45 (post-review diffs, weak label); BigCodeReward A/B agreement 0.55–0.58 with the rubric judge calling a tie in 55% of pairs; merged-vs-closed on 62 agent PRs is at chance. These say 'we could not show agreement with humans', not 'judges disagree with humans'. Not run: Devin and Haiku in the attack, pool or verified settings; an attacker that adapts to consensus; independent blind-generated tests, which is the obvious next experiment.",
      body: <section className="slide">
        <h2>10. What this does and does not show</h2>
        <ul className="caveats">
          <li><b>Shows:</b> LLM judges beat chance on whether tests pass; the ranking signal lives in the code and the exploit in the test channel; the exploit transfers, compounds under optimisation, and no threshold makes the score a gate; execution checks and cross-agent consensus each remove part of it, not half.</li>
          <li><b>Does not show:</b> that any judge is "best" or safe; that passing hidden tests means good code; agreement with humans (SWE-PRBench AUROC 0.42–0.45 on a post-review label; BigCodeReward agreement 0.55–0.58; merged-vs-closed at chance).</li>
          <li><b>Caveats:</b> public data may be in training sets; one attacker model, three rounds, replayed (not re-tuned) against the later defences; Devin and Haiku were not run in the attack or verified settings; one model snapshot each.</li>
          <li><b>Use it as:</b> a regression suite for whoever picks or changes a code judge, with pre-registered metrics and repo-clustered error bars. Gate on execution evidence the agent did not produce; use the judge to rank.</li>
        </ul>
        <p className="lead">Full numbers: <Link to="/overview">Overview</Link>, <Link to="/findings">Findings</Link>, <Link to="/board">Leaderboard</Link>, <Link to="/method">Method</Link>.</p>
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

  return (
    <div className="demo">
      {slides[i].body}
      {notes && <div className="notes"><b>Speaker notes.</b> {slides[i].note}</div>}
      <div className="controls">
        <button className="btn" onClick={() => go(-1)} disabled={pos === 0}>← Back</button>
        <div className="dots">{order.map((k) => <span key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} />)}</div>
        <span className="small muted">{pos + 1} / {order.length}</span>
        <span className="mode">
          <button className={`btn ${short ? "on" : ""}`} onClick={() => { setShort((x) => !x); setI(0); }}>{short ? "90-second version" : "full version"}</button>{" "}
          <button className={`btn ${notes ? "on" : ""}`} onClick={() => setNotes((x) => !x)}>notes</button>
        </span>
        <button className="btn primary" onClick={() => go(1)} disabled={pos === order.length - 1}>{pos === 0 ? "Start →" : "Next →"}</button>
      </div>
    </div>
  );
}
