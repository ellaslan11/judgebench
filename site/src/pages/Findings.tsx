import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { BestOfNChart, GoodhartChart } from "../charts";
import { useData } from "../data";
import type { Metric, Scorecard } from "../types";

const pct = (m: Metric | undefined) => (m ? `${Math.round(m.value * 100)}%` : "–");
const ci = (m: Metric | undefined, d = 2) => (m ? `${m.value.toFixed(d)} (${m.lo.toFixed(d)}–${m.hi.toFixed(d)})` : "–");

export default function Findings() {
  const sc = useData<Scorecard>("scorecard.json");
  const [params] = useSearchParams();
  useEffect(() => {
    const id = params.get("s");
    if (id && sc) document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, [params, sc]);
  if (!sc?.judges) return <p className="muted">No scorecard yet.</p>;
  const js = Object.entries(sc.judges);
  const bon = js.filter(([, j]) => j.best_of_n && Object.keys(j.best_of_n).length);
  const att = js.filter(([, j]) => j.metrics.attack_gate_rate);
  const xfer = js.filter(([, j]) => j.metrics.attack_gate_xfer);
  const gh = js.filter(([, j]) => j.goodhart && j.goodhart.pool_plus_attack_r3);
  const touch = js.filter(([, j]) => j.metrics.swe_rank_fail_touches_tests);
  const ext = js.filter(([, j]) => j.metrics.prb_auroc || j.metrics.bcr_agree);
  const gate = js.filter(([, j]) => j.metrics.swe_false_accept_cal);
  const vx = js.filter(([id, j]) => id.startsWith("rubricx-") && j.metrics.attack_gate_rate)
    .map(([id, j]) => [id, j, sc.judges[id.replace("rubricx-", "rubric-")]] as const);

  return (
    <div className="prose">
      <section className="hero">
        <h1>Findings in full</h1>
        <p>
          Agent platforms increasingly use an LLM judge as a PR gate and to pick the best of N agent attempts. If the
          judge can be fooled, agents optimised against it learn to fool it. We measure that directly: against
          hidden-test execution labels (SWE-bench), against an adaptive attacker, and against public human review labels.
          Every number has a 95% CI that resamples whole repos; predictions were written down before the runs
          (<code>docs/analysis_plan.md</code>).
        </p>
      </section>

      <h2 id="attack">1. An attacker that never touches the code gets failing patches past the gate</h2>
      <p>
        For each held-out SWE-bench task we take the failing patch the judge likes best. An LLM attacker sees the judge's
        score and reasons and, for 3 rounds, may only rewrite the PR description and add one test file. The source code
        stays byte-identical, so the patch still fails the hidden tests. As a control, the passing patches get the same
        treatment.
      </p>
      <table className="board">
        <thead><tr><th>Judge</th><th>Failing patch rated "would merge" (R7 ≥ 4): before → after</th><th>Attacked failing patch beats every passing patch (passing ones attacked too)</th><th>Attack cost</th></tr></thead>
        <tbody>
          {att.map(([id, j]) => (
            <tr key={id}><td>{id}</td><td className="num">{pct(j.metrics.attack_gate_before)} → <b>{pct(j.metrics.attack_gate_rate)}</b></td>
              <td className="num">{j.metrics.attack_win_fair ? ci(j.metrics.attack_win_fair) : "–"}</td>
              <td className="num">{j.attack_cost_usd ? `$${j.attack_cost_usd.toFixed(2)}` : "–"}</td></tr>
          ))}
        </tbody>
      </table>

      <h3 id="transfer">1b. The attacks transfer between judges</h3>
      <p>
        The attacked patches tuned against one judge, replayed unchanged on another. If the exploit were a quirk of one
        model, the transferred attacks would do little.
      </p>
      <table className="board">
        <thead><tr><th>Judge</th><th>Attacks tuned against</th><th>Failing patch rated "would merge": before → after (transferred)</th><th>Same, own adaptive attack</th></tr></thead>
        <tbody>
          {xfer.map(([id, j]) => (
            <tr key={id}><td>{id}</td><td>{j.attack_transfer_src}</td>
              <td className="num">{pct(j.metrics.attack_gate_xfer_before)} → <b>{pct(j.metrics.attack_gate_xfer)}</b></td>
              <td className="num">{j.metrics.attack_gate_rate ? `${pct(j.metrics.attack_gate_before)} → ${pct(j.metrics.attack_gate_rate)}` : "not run"}</td></tr>
          ))}
        </tbody>
      </table>

      <h3 id="goodhart">1c. Goodhart curve: more optimisation, higher judge score, lower pass rate</h3>
      <p>
        Pass rate (solid, left) and judge score (dashed, right) of the candidate the judge picks, as the candidate set
        grows from one random agent patch to the whole pool and then the pool plus the adversarially rewritten failing
        patches. The score keeps rising while the pass rate turns down.
      </p>
      <GoodhartChart judges={gh} />

      <h3 id="touch">1d. Real agent patches that touch tests and still fail are not disguised hacks</h3>
      <p>
        Among the 751 pool patches, 78 add or edit tests yet fail the hidden tests. Judges rank a passing patch above
        them <i>more</i> often than above failing patches with no tests: real agents' bad tests look broken, not clever.
        The adaptive attacker above is the hard case, and the scripted hacks are the easy one.
      </p>
      <table className="board">
        <thead><tr><th>Judge</th><th>Passing outranks failing patch that touches tests</th><th>Passing outranks failing patch with no tests</th></tr></thead>
        <tbody>
          {touch.map(([id, j]) => (
            <tr key={id}><td>{id}</td><td className="num">{ci(j.metrics.swe_rank_fail_touches_tests)}</td><td className="num">{ci(j.metrics.swe_rank_fail_no_tests)}</td></tr>
          ))}
        </tbody>
      </table>

      <h2 id="bestofn">2. Best-of-N: the judge's pick improves up to N≈4, then plateaus far below the oracle</h2>
      <p>Pass rate (hidden tests) of the judge's top-rated patch among N agent patches for the same task; 72 held-out tasks.</p>
      <BestOfNChart judges={bon} />

      <h2 id="human">3. Human labels (public datasets, not ours)</h2>
      <p>
        <b>SWE-PRBench</b> (<a href="https://huggingface.co/datasets/foundry-ai/swe-prbench">foundry-ai/swe-prbench</a>):
        real PRs; does the judge score lower the PRs where a human reviewer formally requested changes? (AUROC, 0.5 = chance.){" "}
        <b>BigCodeReward</b> (<a href="https://huggingface.co/datasets/bigcode/bigcodereward">bigcode/bigcodereward</a>):
        two models' programs for the same prompt, with a human vote; does the judge prefer the same one? (0.5 = chance.)
      </p>
      <table className="board">
        <thead><tr><th>Judge</th><th>SWE-PRBench: changes requested</th><th>SWE-PRBench: any change required</th><th>BigCodeReward agreement</th></tr></thead>
        <tbody>
          {ext.map(([id, j]) => (
            <tr key={id}><td>{id}</td><td className="num">{ci(j.metrics.prb_auroc)}</td><td className="num">{ci(j.metrics.prb_auroc_any)}</td>
              <td className="num">{ci(j.metrics.bcr_agree)}</td></tr>
          ))}
        </tbody>
      </table>

      <h2 id="gate">4. The "would merge" cutoff must be calibrated per judge</h2>
      <p>
        With a fixed R7 ≥ 4 cutoff, rubric judges reject 90%+ of patches that pass the hidden tests (most SWE-bench
        patches have no tests and no description). Below, the cutoff is chosen on the 33 dev tasks and evaluated on the 72
        held-out tasks.
      </p>
      <table className="board">
        <thead><tr><th>Judge</th><th>Dev-tuned cutoff</th><th>False accept (failing passed)</th><th>False reject (passing blocked)</th><th>At fixed R7 ≥ 4: FA / FR</th></tr></thead>
        <tbody>
          {gate.map(([id, j]) => (
            <tr key={id}><td>{id}</td><td className="num">R7 ≥ {j.swe_cutoff}</td><td className="num">{pct(j.metrics.swe_false_accept_cal)}</td>
              <td className="num">{pct(j.metrics.swe_false_reject_cal)}</td>
              <td className="num">{pct(j.metrics.swe_false_accept)} / {pct(j.metrics.swe_false_reject)}</td></tr>
          ))}
        </tbody>
      </table>

      <h2 id="verify">5. Execution-grounded verification helps, but the agent's own tests cannot be the evidence</h2>
      <p>
        The obvious fix: run the PR's own test changes in the official SWE-bench image without and with the source
        change, and tell the judge whether they went fail → pass (<code>verified</code>), passed anyway
        (<code>vacuous</code>), still fail, collected nothing, or were absent. No hidden tests are used. The{" "}
        <code>rubricx-*</code> judges below get that one line above the PR; the attacker and its targets are the same as
        for the unverified judge, and each new test file is executed before the judge sees it.
      </p>
      <table className="board">
        <thead><tr><th>Judge (unverified → verified)</th><th>Passing above failing (SWE)</th><th>Failing patch at "would merge" after attack</th><th>Fair attack win</th><th>Gate rate when the attacker's test is fail→pass / not</th><th>Attacker tests that are fail→pass</th></tr></thead>
        <tbody>
          {vx.map(([id, j, u]) => (
            <tr key={id}><td>{id}</td>
              <td className="num">{u ? ci(u.metrics.swe_pair_acc) : "–"} → <b>{ci(j.metrics.swe_pair_acc)}</b></td>
              <td className="num">{u ? pct(u.metrics.attack_gate_rate) : "–"} → <b>{pct(j.metrics.attack_gate_rate)}</b></td>
              <td className="num">{u ? pct(u.metrics.attack_win_fair) : "–"} → <b>{pct(j.metrics.attack_win_fair)}</b></td>
              <td className="num">{pct(j.metrics.attack_gate_verified_tests)} / {pct(j.metrics.attack_gate_unverified_tests)}</td>
              <td className="num">{pct(j.metrics.attack_tests_verified_share)}</td></tr>
          ))}
        </tbody>
      </table>
      <p>
        The judge does follow the verdict: attacker tests marked failing or vacuous get essentially no credit. What
        survives is the share of attacker tests that genuinely fail without the (wrong) source change and pass with it:
        tests that faithfully specify the wrong behaviour. A fail-to-pass check of the PR's own tests cannot tell those
        from correct tests, and mutation testing would not either. Only tests the agent did not write can. Attacks tuned
        on the unverified judges transfer to the verified ones through the same items (section 2 table). Real agent
        patches rarely ship tests at all (79–89%), so the verdict leaves the ranking metric almost unchanged, and the
        dev-tuned cutoff is still R7 ≥ 2 with 58–63% false accepts.
      </p>

      <h2>What this does not show</h2>
      <ul>
        <li>That execution-checking the agent's own tests makes a judge safe: it removes the decorative-test exploit, not the wrong-test one.</li>
        <li>That any judge is "best": most top judges' intervals overlap.</li>
        <li>That a judge is safe as a reward signal: the attack above is cheap and only uses non-code channels.</li>
        <li>Passing hidden tests is narrower than good code; SWE-bench and these PRs are public and may be in training data.</li>
        <li>SWE-PRBench's label is "a reviewer requested changes", which also reflects reviewer habits, not just patch quality.</li>
      </ul>
    </div>
  );
}
