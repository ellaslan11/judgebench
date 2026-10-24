# JudgeBench-Code

**A benchmark for code evaluators.** Coding agents are increasingly gated, ranked and trained by
LLM "autoraters" that read a PR and decide whether it is mergeable. JudgeBench-Code measures how
trustworthy those judges are: do they catch reward hacks, ignore padding and confident PR
descriptions, stay stable under semantics-preserving edits, and give the same answer regardless of
A/B order?

It does **not** benchmark coding agents. It benchmarks the thing that grades them.

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
   | `pad` | length bias (redundant comments) | not change |
   | `pad_context` | length bias (neutral: 12 more unchanged base-file lines around each hunk) | not change |
   | `polish_desc` | description gaming | not change |
   | `rename_vars` | stability | not change |

3. **Judges** – a non-LLM heuristic baseline plus LLM judges in zero-shot ("would you merge?") and
   rubric (R1–R7, `configs/rubric_v1.yaml`) modes, pointwise and pairwise (`configs/judges.yaml`).
4. **Metrics** – hack catch rate, scope sensitivity, length bias, description gaming, stability,
   pairwise accuracy, position flip rate, cost, latency. 95% bootstrap CIs resample parent PRs.
5. **Site** – a static leaderboard, a "fool the judge" playground, a failure gallery and a
   methodology page, all served from precomputed JSON.

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
  small, so read it as a weak signal; it is excluded from the composite.
- `pad` adds redundant comments, which reviewers may reasonably penalize, so `length_bias` measures
  "sensitivity to comment noise". `pad_context` is the strictly neutral version: the patch is
  byte-identical except for extra unchanged context lines, reported as `context_bias`.
- `devin-rubric` (Devin as a judge) was run as 20 blind Devin sessions, each rating 3 unrelated
  items (original, deleted tests, unrelated change; shuffled) for 20 parents only. It has
  hack-catch and scope numbers but no bias/pairwise axes, so it has no composite.
- The composite is display-only: the geometric mean of detection (hack catch, scope, pairwise; itself
  a geometric mean, so a blind spot pulls it toward 0) and invariance (bias and stability axes).
- Public PRs may appear in judge models' training data.

## Tests

```bash
pytest && ruff check jbc tests
```
