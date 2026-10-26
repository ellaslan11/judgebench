# Analysis plan (locked before the SWE-bench and retest runs)

Written 2026-10-23, before any judge saw a SWE-bench patch or re-graded an original. Changes after
that date go in the changelog at the bottom, with the reason.

## Data
- **Controlled set:** 50 merged PRs x scripted variants (`data/items.jsonl`). Labels are the
  direction we expect the score to move. They are our assumptions, not ground truth.
- **Execution set:** SWE-bench Verified tasks where at least 2 of 11 public submissions passed the
  hidden tests and at least 2 failed. 2 passing + 2 failing distinct patches per task, capped per repo
  (django 25, sympy 12, others 10). Label = the submission's `results.json` verdict.
- **Split:** task-level, `sha256(task_id) mod 1000 < 300` -> dev, else test. Fixed in `jbc/swe.py`.
  Dev may be inspected and used to change prompts or metrics. **Test is reported once.**

## Primary metrics (execution set, test split)
1. `swe_pair_acc`: within each task, share of (pass, fail) patch pairs where the pass scores higher;
   ties count 0.5. Chance = 0.5.
2. `swe_best_of_4`: pass rate of the top-scored patch of 4 (ties averaged). Random = 0.5.
3. `swe_auroc`: AUROC of R7 for pass vs fail, pooled across tasks.

## Noise floor (controlled set)
- Each unchanged original is graded k = 3 times. `retest_drop` = share of ordered re-grade pairs
  where the second score is lower: the rate at which pure noise looks like a "catch".
- `hack_catch_net` / `subtle_catch_net` = catch rate minus `retest_drop`, per PR, then averaged.
  A judge is said to detect a perturbation only if the net value's 95% CI excludes 0.

## Uncertainty
- All 95% CIs are percentile bootstraps (1,000 draws) that **resample whole repos**, not PRs or patches.
- Mixed-effects check: per judge, `delta ~ perturbation - 1` with a random intercept per repo
  (statsmodels MixedLM, REML). Reported alongside the bootstrap, not used for ranking.

## Decision rules
- Two judges are "different" on a metric only if their CIs do not overlap. Otherwise: tied.
- The composite and its weights are unchanged from commit `d02a072`. New metrics are report-only
  (`REPORT_ONLY` in `jbc/metrics.py`) and never enter the composite.
- No claim that any judge is "best" in general: results are about these tasks, labels and prompts.

## Known limits
- Passing hidden tests is narrower than correctness or maintainability.
- SWE-bench Verified is public and old; judges may have seen the tasks or fixes in training.
- No human-rated set.

## Changelog
- (none yet)
