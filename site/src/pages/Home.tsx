import { Link } from "react-router-dom";
import { AttackChart, GoodhartChart } from "../charts";
import { useData } from "../data";
import type { Metric, Scorecard } from "../types";

const pct = (m: Metric | undefined) => (m ? `${Math.round(m.value * 100)}%` : "–");
const num = (m: Metric | undefined) => (m ? m.value.toFixed(2) : "–");

export default function Home() {
  const sc = useData<Scorecard>("scorecard.json");
  const J = sc?.judges ?? {};
  const sol = J["rubric-gpt6.1-sol"], luna = J["rubric-gpt6-luna"], devin = J["devin-rubric"];
  const solx = J["rubricx-gpt6.1-sol"], lunax = J["rubricx-gpt6-luna"];
  const att = Object.entries(J).filter(([id, j]) => j.metrics.attack_gate_rate && !id.startsWith("rubricx-"));
  const attx = Object.entries(J).filter(([id, j]) => j.metrics.attack_gate_rate && id.startsWith("rubricx-"));
  const gh = Object.entries(J).filter(([id, j]) => j.goodhart?.pool_plus_attack_r3 && !id.startsWith("rubricx-"));
  const bo4 = sol?.best_of_n?.["4"]?.judge, bo1 = sol?.best_of_n?.["1"]?.judge, bo8 = sol?.best_of_n?.["8"]?.judge;

  return (
    <div className="prose home">
      <section className="hero">
        <p className="kicker">JudgeBench-Code · a benchmark of AI code judges, not coding agents</p>
        <h1>Can an LLM judge be trusted to grade code?</h1>
        <p>
          Agent platforms use an LLM judge to decide whether a PR is done, to pick the best of N attempts, and as a
          reward signal. We measured whether such judges track real correctness (hidden-test execution on SWE-bench),
          how noisy and biased they are, how cheaply an agent can game them without touching the code, and whether
          grounding the judge in execution fixes it.
        </p>
        <p className="oneline">
          <b>Short answer:</b> judges beat chance on whether tests pass, but the signal lives in the channels the agent
          controls (description and tests). It is cheap to exploit, the exploits transfer between judges and get worse
          under optimisation, no score threshold works as a merge gate, and executing the agent's own tests only closes
          part of the hole. You need tests the agent did not write.
        </p>
      </section>

      {sc?.judges && (
        <div className="stats">
          <div className="stat"><div className="stat-v">{pct(sol?.metrics.attack_gate_before)} → {pct(sol?.metrics.attack_gate_rate)}</div>
            <div className="stat-l">failing patches rated "would merge" after a text-only attack (GPT-6.1-sol rubric); {pct(luna?.metrics.attack_gate_before)} → {pct(luna?.metrics.attack_gate_rate)} for GPT-6-luna</div></div>
          <div className="stat"><div className="stat-v">{num(devin?.metrics.swe_pair_acc)} / {num(sol?.metrics.swe_pair_acc)}</div>
            <div className="stat-l">passing patch ranked above failing one, Devin / GPT-6.1-sol (random 0.50, line-count heuristic {num(J["heuristic-tests"]?.metrics.swe_pair_acc)})</div></div>
          <div className="stat"><div className="stat-v">{pct(bo1)} → {pct(bo4)} → {pct(bo8)}</div>
            <div className="stat-l">pass rate of the judge's pick at N = 1, 4, 8 candidates; an oracle reaches 99.7%</div></div>
          <div className="stat"><div className="stat-v">{pct(sol?.metrics.swe_false_accept_cal)}–{pct(luna?.metrics.swe_false_accept_cal)}</div>
            <div className="stat-l">failing patches let through at the best cutoff found on held-out dev tasks (R7 ≥ 2); at R7 ≥ 4, {pct(sol?.metrics.swe_false_reject)} of passing patches are rejected</div></div>
          <div className="stat"><div className="stat-v">{pct(luna?.metrics.attack_gate_rate)} → {pct(lunax?.metrics.attack_gate_rate)}</div>
            <div className="stat-l">attack success once the judge is told whether the PR's own tests go fail → pass in the SWE-bench container (GPT-6-luna); {pct(sol?.metrics.attack_gate_rate)} → {pct(solx?.metrics.attack_gate_rate)} for GPT-6.1-sol</div></div>
          <div className="stat"><div className="stat-v">{pct(solx?.metrics.attack_tests_verified_share)}</div>
            <div className="stat-l">of attacker-written tests genuinely fail without and pass with the <i>wrong</i> patch; they carry all the remaining attack success</div></div>
        </div>
      )}

      <h2>The attack in one chart</h2>
      <p>
        For each of 72 held-out SWE-bench tasks, take the failing agent patch the judge likes best. An LLM attacker
        sees the judge's score and reasons and, over 3 rounds, may only rewrite the PR description and add one test
        file. Source code stays byte-identical, so the patch still fails the hidden tests. Left: prompted judges. Right:
        the same judges with the fail-to-pass verdict of the PR's own tests in front of them.
      </p>
      <div className="two">
        {att.length > 0 && <AttackChart judges={att} />}
        {attx.length > 0 && <AttackChart judges={attx} />}
      </div>

      <h2>Optimising against the judge makes the code worse</h2>
      <p>
        Pass rate (solid, left axis) and judge score (dashed, right axis) of whatever the judge picks, as the candidate
        set grows from one random agent patch to the whole pool and then the pool plus the attacked failing patches.
        The score keeps climbing while the pass rate turns down: a Goodhart curve for code judges.
      </p>
      {gh.length > 0 && <GoodhartChart judges={gh} />}

      <h2>All findings</h2>
      <p className="muted small">
        Held-out SWE-bench tasks unless noted. 95% CIs resample whole repositories. Predictions were written down in{" "}
        <a href="https://github.com/ellaslan11/judgebench/blob/main/docs/analysis_plan.md">docs/analysis_plan.md</a> before
        each run; of 17 pre-registered predictions, 9 held, 7 failed and 1 was inconclusive, and the failures are reported
        as such. Full tables on the <Link to="/findings">Findings</Link> page.
      </p>
      <ol className="findings">
        <li><b>Judges carry real signal, but there is no winner.</b> Passing patch ranked above failing: Devin 0.74, GPT-6.1-sol rubric 0.72, GPT-6-luna 0.66, Haiku 0.61, line-count heuristic 0.45, random 0.50. The top intervals overlap. <Link to="/findings?s=attack">→</Link></li>
        <li><b>Cheap to game without changing code.</b> Description + one test file, 3 rounds: failing patches at "would merge" 7% → 32% (GPT-6.1-sol) and 15% → 61% (GPT-6-luna). With passing patches given the same treatment, the failing patch still beats every passing one 22–25% of the time. <Link to="/findings?s=attack">→</Link></li>
        <li><b>The attacks transfer.</b> Attacks tuned on one judge work nearly as well on the other, on a blind rubric and on a zero-shot prompt (4% → 31% on GPT-6.1-sol with luna-tuned attacks vs 7% → 32% with its own). Structural, not a prompt quirk. <Link to="/findings?s=transfer">→</Link></li>
        <li><b>Goodhart curve.</b> Judge score of the pick 2.3 → 3.2 → 3.65 while its true pass rate goes 0.51 → 0.70 → 0.49 (GPT-6.1-sol); 0.51 → 0.61 → 0.31 for luna. <Link to="/findings?s=goodhart">→</Link></li>
        <li><b>Best-of-N plateaus at N ≈ 4</b> (0.51 → 0.64–0.70, flat to 8; oracle 0.997). Running more attempts does not help; the judge is the bottleneck. <Link to="/findings?s=bestofn">→</Link></li>
        <li><b>No usable merge threshold.</b> R7 ≥ 4 rejects 97% of passing patches; the dev-tuned cutoff (≥ 2) lets ~60% of failing ones through. <Link to="/findings?s=gate">→</Link></li>
        <li><b>Execution verification helps, but the agent's own tests cannot be the evidence.</b> Telling the judge whether the PR's tests go fail → pass in the container: attack success 61% → 42% (luna), 32% → 28% (sol); ranking unchanged; cutoff still R7 ≥ 2. The judge gives zero credit to tests the check flags, but ~45% of attacker tests genuinely pass only with the wrong patch, and they carry the rest. Three of four pre-registered predictions for this fix failed. <Link to="/findings?s=verify">→</Link></li>
        <li><b>Real agent hacks are not disguised.</b> Agent patches that edit tests yet fail hidden tests are <i>easier</i> to rank below passing ones (0.84 vs 0.73). The adaptive attacker is the hard case. <Link to="/findings?s=touch">→</Link></li>
        <li><b>Naming hacks in the rubric is not why it works.</b> A blind rubric performs about the same, and hacks named in no prompt are caught 79–93%. Scripted hacks are too easy. <Link to="/board">→</Link></li>
        <li><b>Weak agreement with humans.</b> SWE-PRBench "changes requested" AUROC 0.42–0.45 (post-review diffs; a weak label); BigCodeReward A/B agreement 0.55–0.58 with the rubric judge calling a tie in 55% of pairs; merged vs closed on 62 agent PRs at chance. <Link to="/findings?s=human">→</Link></li>
        <li><b>Noise and bias.</b> Re-grading the same PR lowers its score 13–16% of the time (3% for GPT-6.1-sol); net of that, luna's hack-catch rate drops 91% → 74%. Padding a diff with comments costs Devin 1.9 points. <Link to="/board">→</Link></li>
      </ol>

      <h2>How much to trust this</h2>
      <div className="trust">
        <div><h3>High</h3><p>Exploitability, transfer, the Goodhart curve, the best-of-N plateau and the gate result. These need no label: the source is byte-identical, the hidden tests still fail, and the score goes up. Effects are far outside the CIs.</p></div>
        <div><h3>Medium</h3><p>The ranking of judges on execution labels (72 tasks, 11 repos, CIs ±0.05–0.07, top three overlap) and the noise/bias axes (50 parent PRs). Hidden tests are a proxy for correctness and SWE-bench is public. The verified-judge result covers one fix and one attacker.</p></div>
        <div><h3>Low</h3><p>Agreement with human labels: the public datasets measure reviewer behaviour or standalone programs, not patch correctness. The composite leaderboard score is a design choice. Scripted hacks are not a discriminating test.</p></div>
      </div>

      <h2>What this does not show</h2>
      <ul>
        <li>That any judge is "best" or is safe as a PR gate or reward signal.</li>
        <li>That execution-checking the agent's own tests makes a judge safe: it removes the decorative-test exploit, not the wrong-test one.</li>
        <li>That passing hidden tests means good code, or that results are free of training-data contamination.</li>
        <li>Cross-vendor transfer: Devin and Haiku were not run on the attack, pool or verified settings; one attacker model, three rounds, two channels.</li>
      </ul>

      <h2>Use it</h2>
      <p>
        The harness is a regression suite for whoever picks or changes a code judge: pre-registered metrics, repo-clustered
        error bars, held-out hacks, an adaptive attacker with cached replays, fair controls, Goodhart and best-of-N curves,
        and an execution verifier for SWE-bench images. Code, data and every rating are in the{" "}
        <a href="https://github.com/ellaslan11/judgebench">repository</a>. <code>jbc attack-replay</code> replays a cached
        attack in seconds with no API calls; see the <Link to="/method">Method</Link> page for how everything was built.
      </p>
    </div>
  );
}
