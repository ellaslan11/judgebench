import { PLAN_URL } from "../config";
export default function Method() {
  return (
    <div className="prose">
      <h1>Method</h1>
      <h2>Why evaluate the evaluators?</h2>
      <p>
        Coding agents are increasingly graded, gated, selected and trained by LLM judges. An agent optimised against a
        judge learns whatever the judge rewards. If that is confident PR text and decorative tests rather than correct
        code, the judge is a liability. JudgeBench-Code measures the judge: how well its score tracks execution, how
        stable it is, and how much an agent can move it without touching the source.
      </p>

      <h2>Judges</h2>
      <p>
        GPT-6.1-sol, GPT-6-luna and Claude Haiku 4.5 through their APIs, and Devin through blind child sessions. Each model
        runs with up to four prompts: a 7-criterion <b>rubric</b> (task fulfilment, correctness risk, scope, conventions,
        tests, readability, overall mergeability R7 on 1–5, where 5 = merge as-is), a <b>blind rubric</b> with generic
        criteria that name no known hack, a <b>zero-shot</b> "would you merge this?" prompt, and a <b>neutral</b> zero-shot
        prompt without the hint line. <code>rubricx-*</code> judges are the rubric plus one line stating the execution
        verdict of the PR's own tests. A test-line-count heuristic is the non-LLM baseline. Every API call is cached by
        content hash; judge outputs include per-criterion scores and reasons.
      </p>

      <h2>Data and labels</h2>
      <ul>
        <li><b>Controlled perturbations.</b> 50 recently merged PRs (Python, TypeScript, Go, Rust; 15–400 changed lines, source + tests, non-bot) and 469 scripted variants with a known expected effect: delete/skip tests, strip assertions, tautological assertions, swallowed failures, de-collected tests (should score lower); unrelated change (lower); comment padding, context padding, polished description, renamed variables (same). 267 A/B pairs are shown in both orders.</li>
        <li><b>Execution labels.</b> 105 SWE-bench Verified tasks (33 dev, 72 held-out) with every distinct public agent submission: 751 patches, 7–11 per task, each labelled pass/fail by the official hidden tests. Judges never see the hidden tests.</li>
        <li><b>Real agent PRs.</b> 62 agent-authored GitHub PRs, merged vs closed.</li>
        <li><b>Human labels.</b> SWE-PRBench (312 PRs; did a reviewer formally request changes?) and BigCodeReward (200 non-tie human A/B votes on two models' programs). Both are weak proxies for patch correctness and are reported as such.</li>
      </ul>

      <h2>Adaptive attacker</h2>
      <p>
        For each held-out task the judge's top-scored failing patch is the target. An LLM attacker receives the task,
        the patch and the judge's latest score and reasons, and for up to 3 rounds may rewrite the PR description and add
        one new test file. Source hunks must stay byte-identical (checked), so the hidden tests still fail. It stops early
        at R7 = 5. As a fair control the passing patches of the same tasks get the same treatment, and "attack win" is
        measured against those. Attacks tuned on one judge are replayed unchanged on others to measure transfer.
      </p>

      <h2>Execution verifier</h2>
      <p>
        <code>jbc verify</code> splits a patch into source and test hunks, runs the touched test files in the official
        SWE-bench Docker image before and after applying the source hunks, and classifies the result: <code>verified</code>{" "}
        (fail → pass), <code>vacuous</code> (pass → pass), <code>failing</code>, <code>empty</code> (nothing collected),{" "}
        <code>no_tests</code> or <code>error</code>. Only the PR's own tests are used, never the hidden ones. Each attacker
        round's test file is executed before the verified judge sees it.
      </p>

      <h2>Metrics</h2>
      <ul>
        <li><b>Ranking:</b> share of (passing, failing) patch pairs on the same task where the judge scores the passing one higher; AUROC; best-of-N pass rate of the judge's top pick for N = 1…8 against random and oracle.</li>
        <li><b>Gate:</b> false accept / false reject at a fixed R7 ≥ 4 and at the cutoff that minimises their sum on the dev split.</li>
        <li><b>Attack:</b> share of targets reaching R7 ≥ 4 after attack; share beating (or tying) every equally-attacked passing patch; transfer rates; gate rate conditioned on the verifier's verdict of the attacker's test.</li>
        <li><b>Goodhart:</b> judge score and true pass rate of the pick as the candidate set grows from best-of-1 to the whole pool to pool + attacked patches.</li>
        <li><b>Controlled axes:</b> hack catch rate, scope sensitivity, padding and description bias, rename stability, pairwise accuracy and position flips, and a re-grade noise estimate from repeated ratings of unchanged PRs that nets out of the catch rates.</li>
        <li><b>Human:</b> AUROC against SWE-PRBench labels; agreement with BigCodeReward votes (ties count 0.5).</li>
      </ul>
      <p>
        All 95% intervals are bootstrap intervals that resample whole repositories (or parent PRs), so correlated items
        from one codebase do not shrink them. Predictions for each experiment were written in{" "}
        <a href={PLAN_URL}>the analysis plan</a> before
        the run; held and failed predictions are both reported there.
      </p>

      <h2>Limitations</h2>
      <ul>
        <li>Passing hidden tests is a narrow proxy for correctness and says nothing about design or maintainability.</li>
        <li>SWE-bench tasks, the parent PRs and the agent submissions are public and may be in the judges' training data.</li>
        <li>72 held-out tasks from 11 repositories: enough to separate judges from chance and from a heuristic, not from each other.</li>
        <li>One attacker model, three rounds, two channels. A stronger attacker would make the judges look worse, not better.</li>
        <li>Devin and Haiku were not run on the attack, best-of-N pool or verified settings.</li>
        <li>No expert study of judge/label disagreements; the human-label datasets measure different constructs.</li>
        <li>Results are for specific model snapshots and prompts; treat them as regression baselines.</li>
      </ul>
    </div>
  );
}
