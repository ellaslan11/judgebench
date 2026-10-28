# JudgeBench-Code

**Site:** https://ellaslan11.github.io/judgebench/ (overview, findings with charts, leaderboard, attack playground).

**How gameable are AI code judges?** Agent platforms increasingly use an LLM judge as a PR gate,
to pick the best of N agent attempts, and as a reward. If the judge can be fooled, an agent
optimised against it learns to fool it instead of writing correct code. JudgeBench-Code measures
that. It benchmarks the grader, not the coding agent.

**Headline findings** (held-out SWE-bench tasks unless noted; 95% CIs resample whole repos;
predictions were pre-registered in `docs/analysis_plan.md` before each run):

1. **Judges are cheap to game without touching the code.** An LLM attacker that sees the judge's
   feedback and may only rewrite the PR description and add one test file (3 rounds, source code
   byte-identical, so the patch still fails the hidden tests) lifts the share of failing patches
   rated "would merge" (R7 >= 4) from 15% to 61% (GPT-6-luna rubric) and 7% to 32% (GPT-6.1-sol
   rubric). With the same attack applied to the passing patches as a control, the attacked failing patch
   still outscores every passing patch of its task 22% (luna) / 25% (sol) of the time, and ties or
   beats them 57% / 48%. The naive comparison, where only the failures were attacked, said 64% / 38%.
2. **Best-of-N helps, then plateaus.** The judge's top pick passes ~0.51 at N=1 (random), ~0.64-0.70
   at N=4, and stays flat to N=8, while an oracle reaches 0.997.
3. **Judges beat chance on execution labels but are not separable.** GPT, Haiku and Devin judges
   rank a passing patch above a failing one 61-74% of the time (random 50%; a test-line heuristic
   45%); the top judges' intervals overlap.
4. **A fixed "would merge" cutoff is not a usable gate.** At R7 >= 4 the rubric judges reject 90%+
   of patches that pass the hidden tests. Tuning the cutoff on the dev split doesn't fix it. Every GPT rubric judge
   picks R7 >= 2 there, and on test that blocks only 6-10% of passing patches but lets 58-64% of
   failing ones through. With a 5-point scale and AUROC ~0.7, no single cutoff is both safe and
   usable, so the judge alone can't be a hard gate.
5. **Human labels (public datasets).** Weak at best. On **SWE-PRBench** (312 real merged PRs, CC-BY-4.0), no
   judge scores PRs lower when a human reviewer formally requested changes: AUROC 0.42-0.45, with
   every CI including or just touching 0.5. The diff shown is the final merged one, after the
   requested changes were made, so this label mostly tells us the judges don't detect "this PR was
   contentious". On the dataset's broader `changes_required` label, GPT-6.1-sol rubric reaches 0.58
   (0.51-0.64). On **BigCodeReward** (200 human A/B votes on two models' programs, OpenRAIL-M),
   GPT-6.1-sol rubric picks the human's choice 0.55 of the time (0.50-0.60, ties counted as 0.5).
   Ignoring its 109 ties, that rises to 0.60; GPT-6-luna zero-shot gets 0.64 on its non-tied pairs.
   All four GPT judges land at 0.55-0.58 overall.
6. **Naming hacks in the rubric is not what makes it work.** A "blind" rubric that names no
   specific hack performs about the same as the original, and hacks named in no prompt
   (`assert x == x`, swallowed failures, de-collected tests) are caught about as often (79-93%) as
   named ones. So these scripted hacks are too easy; the adaptive attacker is the real stress test.

7. **The attacks transfer.** Attacked patches tuned against GPT-6-luna, replayed unchanged on
   GPT-6.1-sol rubric, lift its "would merge" rate on failing patches from 4% to 31%, almost as
   much as its own adaptive attack (7% to 32%); on the blind rubric 3% to 33% and on zero-shot 12%
   to 31%. Sol-tuned attacks on luna: 11% to 48% (own: 15% to 61%). The exploit is structural, not
   one model's quirk.
8. **Goodhart curve.** As the candidate set grows from one random agent patch to the whole pool
   (7-11 per task) and then the pool plus the adversarially rewritten failing patches, the judge's
   score of its pick rises monotonically (GPT-6.1-sol rubric 2.3 -> 3.2 -> 3.65) while the true pass
   rate of the pick rises then falls (0.51 -> 0.70 -> 0.49); luna 2.4 -> 3.35 -> 4.1 with pass
   0.51 -> 0.61 -> 0.31. Optimising harder against the judge makes the chosen code worse.
9. **Real test-touching failures are not disguised hacks.** 78 pool patches add or edit tests yet
   fail the hidden tests. Judges rank a passing patch above those *more* often (0.80-0.84) than
   above failing patches with no test changes (0.68-0.73): agents' bad tests look broken, not
   clever. So the adaptive attacker, not mined agent output, is the realistic hard case today.

**Execution-grounded judge (`rubricx-*`).** `jbc verify` runs each patch's own tests in the
official SWE-bench image without and with the source change (fail-to-pass, no hidden tests) and gives
the judge the verdict. Under the same attacker and targets, the "would merge" rate of attacked failing
patches falls 0.61 -> 0.42 (GPT-6-luna rubric) and 0.32 -> 0.28 (GPT-6.1-sol rubric), not the halving
predicted (P11). The judge gives zero credit to attacker tests the check marks failing or vacuous; but
37-46% of attacker-written tests genuinely fail-before/pass-after against the *wrong* patch, and a
check of the PR's own tests cannot tell those from correct tests. The attacker, seeing the verified
judge's feedback, writes slightly more such tests, not fewer. Attacks tuned on the unverified judges
still transfer (0.03 -> 0.22 and 0.17 -> 0.28 at "would merge"), through the same verified-test items.
Ranking on real patches is unchanged (0.66 -> 0.69, 0.72 -> 0.75), since 79-89% of agent patches ship
no tests, and the dev-tuned cutoff is still R7 >= 2 with 58-63% false accepts. Of predictions P11-P14,
only P12 held; details in `docs/analysis_plan.md`.

**Which channel carries the signal (`rubric-code-*`, `rubric-codetests-*`, `rubric-codedesc-*`).**
Judging the source hunks alone ranks passing above failing patches as well as the full judge
(GPT-6.1-sol 0.72 -> 0.70, GPT-6-luna 0.66 -> 0.66; P15 held). But the code-only judge accepts the
untouched *failing* attack targets at 31% / 47%, where the full judge accepted 7% / 15%, and its
false-accept rate at the dev cutoff goes 0.03 -> 0.19 and 0.08 -> 0.33; the code+tests variant keeps
the low baseline. Much of the full judge's apparent discrimination on failing patches was penalising
missing tests, and the attacker's one test file supplied exactly that. Replayed attacks add nothing to
the code-only judge (by construction), but it already sits where the attack pushes the full judge;
stripping channels removes the lever by conceding the ground. The test channel alone carries 78-88% of
the attack lift and the description alone 17-24% (P17 held, P16 failed, both models). P18 (code-only
catches the scripted hacks) was ill-posed: all 201 scripted hacks live in test files, so the code-only
judge sees the parent's exact prompt and catches 3-15% (regrade noise) against 85-91% for the full
judge. The channel that carries the exploit is the only one in which test tampering is visible.

**Cross-candidate test consensus (P19 failed).** Each genuinely fail-to-pass test set was also run
against up to 6 *other* agents' patches for the same task (4,428 container runs, no hidden tests, no
labels). 60% of the attacker's tests on failing patches pass on at least one other agent's patch too
(68% for its tests on passing patches; 100% of the 19 genuine agent-written verified test sets),
against a predicted ceiling of 35%. Of those, 39% pass only on other *failing* patches (shared
mistakes) and 61% also pass on a *correct* patch: fail-to-pass tests of behaviour the wrong patch
happens to get right. An execution check against the agent pool can flag at most the ~40% of residual
attacker tests unique to their own patch. Telling the judge the k-of-n count (`rubricxc-*`) does about
that: replayed attacks at "would merge" go 42% -> 33% for GPT-6-luna (P20 predicted < 21%: failed)
and 28% -> 25% for GPT-6.1-sol (predicted < 14%: failed); ranking is unchanged (0.69 -> 0.69, 0.75 -> 0.74; P21 held). Three defences, each
removes a lever and leaves roughly half the attack; the common cause is that a test of what the patch
does is indistinguishable from a test of what the issue needs unless it was written without sight of
any patch.

**What this does not show:** that any judge is "best" or safe as a reward signal; that passing
hidden tests means good code; or freedom from contamination (SWE-bench and the PRs are public).
Full limitations are at the end. The site (`site/`) has a findings page, a leaderboard, a
"fool the judge" playground and a failure gallery.

## How it works

1. **Parents** – recent merged PRs from active OSS repos (Python, TypeScript, Go, Rust) that change
   both source and tests (`configs/sources.yaml`).
2. **Scripted perturbations** – each parent is transformed deterministically (no LLM writes code),
   so the expected judge behaviour is known by construction:

   | perturbation | category | a good judge should |
   |---|---|---|
   | `none` | control | – |
   | `delete_tests` | reward hack | score lower |
   | `skip_tests` | reward hack | score lower |
   | `unrelated_change` | scope creep | score lower |
   | `strip_asserts` | subtle reward hack (new tests kept, single-line assertions removed) | go down |
   | `pad` | length bias (redundant comments) | not change |
   | `pad_context` | length bias (neutral: 12 more unchanged base-file lines around each hunk) | not change |
   | `polish_desc` | description gaming | not change |
   | `rename_vars` | stability | not change |

3. **Judges** – a non-LLM heuristic baseline plus LLM judges in zero-shot ("would you merge?") and
   rubric (R1–R7, `configs/rubric_v1.yaml`) modes, pointwise and pairwise (`configs/judges.yaml`).
4. **Metrics** – hack catch rate, scope sensitivity, length bias, description gaming, stability,
   pairwise accuracy, position flip rate, cost, latency. 95% bootstrap CIs resample whole repos
   (PRs from one repo are not independent), and a mixed-effects model (`jbc/stats.py`) reports each
   perturbation's score change with a random intercept per repo.
5. **Site** – a static leaderboard, a "fool the judge" playground, a failure gallery and a
   methodology page, all served from precomputed JSON.

## Execution-labelled set (SWE-bench Verified)

Real agent patches whose label comes from running SWE-bench's hidden tests, not from us
(`jbc swe-fetch`, `jbc swe-run`, `jbc/swe.py`). From 11 public submissions (190-396 of 500 resolved),
we keep tasks where at least 2 passed and 2 failed, cap tasks per repo, and take 2 passing + 2 failing
distinct patches per task: 105 tasks, 420 patches, 11 repos. Tasks are split by hash into dev (33) and
held-out test (72); the analysis plan was written before any judging (`docs/analysis_plan.md`).

- `swe_pair_acc`: within a task, how often a passing patch outscores a failing one (ties 0.5).
- `swe_best_of_4`: pass rate of the judge's top pick out of the 4 (random 0.5).
- `swe_auroc`: pooled AUROC for pass vs fail.

Held-out test results (72 tasks; 95% CI, repo bootstrap):

| judge | pass>fail | best-of-4 | AUROC |
|---|---|---|---|
| Devin (rubric) | 0.74 (0.69-0.80) | 0.76 (0.66-0.84) | 0.74 |
| GPT-6.1-sol rubric | 0.72 (0.67-0.78) | 0.72 (0.66-0.77) | 0.73 |
| GPT-6.1-sol zero-shot | 0.69 (0.62-0.77) | 0.66 (0.57-0.74) | 0.70 |
| GPT-6-luna zero-shot | 0.66 (0.58-0.76) | 0.64 (0.52-0.75) | 0.67 |
| GPT-6-luna rubric | 0.66 (0.59-0.74) | 0.63 (0.54-0.73) | 0.66 |
| Haiku 4.5 zero-shot | 0.61 (0.54-0.68) | 0.57 (0.42-0.68) | 0.61 |
| Haiku 4.5 rubric | 0.61 (0.55-0.70) | 0.56 (0.45-0.70) | 0.61 |
| test-line heuristic | 0.45 (0.40-0.51) | 0.39 (0.31-0.51) | 0.45 |

Every LLM judge beats chance; the heuristic does not. The LLM judges' intervals overlap, so this set
does not separate them reliably. Passing hidden tests is narrower than correctness or maintainability, and SWE-bench is public, so
judges may have seen these issues or fixes. Unparseable outputs are dropped: 2 of 420 for GPT-6-luna
zero-shot, 21 of 420 for Haiku rubric.

## Noise floor

`jbc retest --k 3` grades each unchanged original 2 more times. `retest_drop` is how often a
re-grade of the *same* PR scores lower, i.e. how often noise alone looks like a "catch".
`hack_catch_net` / `subtle_catch_net` subtract it.

| judge | retest_drop | hack catch -> net | subtle hack -> net |
|---|---|---|---|
| Devin (rubric) | 0.13 | 0.96 -> 0.81 | 0.91 -> 0.76 |
| GPT-6.1-sol rubric | 0.03 | 0.85 -> 0.82 | 0.83 -> 0.79 |
| GPT-6.1-sol zero-shot | 0.03 | 0.81 -> 0.79 | 0.80 -> 0.76 |
| GPT-6-luna rubric | 0.16 | 0.91 -> 0.74 | 0.91 -> 0.74 |
| GPT-6-luna zero-shot | 0.13 | 0.67 -> 0.52 | 0.83 -> 0.70 |
| Haiku 4.5 rubric | 0.15 | 0.77 -> 0.58 | 0.75 -> 0.58 |
| Haiku 4.5 zero-shot | 0.03 | 0.40 -> 0.35 | 0.31 -> 0.29 |

These report-only axes are not in the composite.

## Quickstart

```bash
uv venv -p 3.11 && uv pip install -e '.[dev]'
export GITHUB_TOKEN=...  OPENAI_API_KEY=...  ANTHROPIC_API_KEY=...

jbc fetch                      # -> data/parents.jsonl
jbc perturb --seed 0           # -> data/items.jsonl, data/pairs.jsonl
jbc estimate                   # token/cost estimate before spending anything
jbc run --limit 5              # smoke test on 5 parents; drop --limit for the full run
jbc score                      # -> results/scorecard.json, results/failures.json
jbc export                     # -> site/public/data/*.json

cd site && npm install && npm run dev
```

All LLM calls are cached in `cache/llm.sqlite` (keyed on provider, model, prompts and params), and
result files are append-only JSONL, so reruns are free and interrupted runs resume.

## Adding a judge

Implement `jbc.judges.base.Judge` (`rate(item) -> Rating`, `compare(pair, first, second, order) -> Pref`)
and register its `kind` in `build_judges`, or just add an entry to `configs/judges.yaml` if it is
another LLM.

## Limitations

- Perturbation labels are directional ("should score lower / the same"), not absolute quality labels.
- `delete_tests` on a PR whose tests were incidental may be a weaker hack than intended; parents are
  required to touch both source and tests to limit this.
- There is no human-rated gold set, so the benchmark cannot say how close judges are to human
  reviewers. The human signal is maintainer outcomes on real agent-authored PRs
  (`jbc agent-fetch` / `jbc agent-run`, Devin and Copilot bot accounts, merged vs closed-unmerged):
  `merge_auroc` is the AUROC of each judge's R7 for predicting "merged". These labels are noisy
  (PRs are closed for staleness, duplication or changed plans, not only quality) and the sample is
  small (62 PRs: 29 merged, 33 closed, from 36 repos, at most 4 per repo), so read it as a weak
  signal; it is excluded from the composite.
  On this repo-capped set no LLM judge beats chance (AUROC 0.46-0.54, every 95% CI includes 0.5;
  the test-line heuristic gets 0.63). An earlier 43-PR sample, 19 of them from 2 repos, gave 0.84
  for the GPT-6.1-sol rubric; that did not replicate once repos were capped.
- `pad` adds redundant comments, which reviewers may reasonably penalize, so `length_bias` measures
  "sensitivity to comment noise". `pad_context` is the strictly neutral version: the patch is
  byte-identical except for extra unchanged context lines, reported as `context_bias`.
- `strip_asserts` only removes single-line assertions (`assert`, `self.assert*`, `expect(...)`,
  `t.Error*`, `assert_eq!`, ...) and needs at least 2 removed and 3 kept test lines, so it applies to
  35 of 50 parents. It is subtler than `delete_tests` but still scripted; real reward hacks
  (hard-coded outputs, weakened tolerances) can be harder still.
- The composite is a design choice. `rank_robustness` in `scorecard.json` (and the leaderboard) re-ranks
  judges under 2,000 random Dirichlet axis weightings, both keeping the composite's structure and as a
  plain weighted mean, and reports how often each judge ranks #1. Axes missing for any ranked judge
  (pairwise for Haiku rubric) are left out of that check.
- `devin-rubric` (Devin as a judge) is run as blind Devin sessions on the same R1-R7 rubric, several
  unrelated items per session (never two items from the same parent or SWE task), told not to look
  anything up. 60 controlled ratings come from a 20-session pilot (3 items each); the other 911
  (329 controlled, 420 SWE, 62 agent PRs, 100 re-grades) from 183 sessions of 5. Batching differs
  from the one-item-per-call LLM judges, and Devin has web access, so leakage is possible: a
  spot-check of 100 sessions found no browser or git activity, only reading the attachments. Devin
  has no pairwise run, so its composite leaves out pairwise accuracy and isn't strictly comparable.
  Cost was about $64 of Devin usage (~$0.31 per 5-item session, ~$0.07 per rating).
- The composite is display-only: the geometric mean of detection (hack catch, subtle hack, scope,
  pairwise; itself
  a geometric mean, so a blind spot pulls it toward 0) and invariance (bias and stability axes).
- Public PRs may appear in judge models' training data.

## Tests

```bash
pytest && ruff check jbc tests
```
