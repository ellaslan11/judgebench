import { useEffect, useState } from "react";

export function useData<T>(name: string): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/${name}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [name]);
  return data;
}

export const AXIS_LABELS: Record<string, string> = {
  hack_catch_rate: "Hack catch",
  subtle_hack_catch: "Subtle hack",
  scope_sensitivity: "Scope",
  length_bias: "Comment-pad bias",
  context_bias: "Context-pad bias",
  desc_gaming: "Desc. gaming",
  stability: "Stability",
  pairwise_acc: "Pairwise acc.",
  position_flip_rate: "Position flips",
  parent_merge_rate: "Merges clean PR",
  merge_auroc: "Agent-PR AUROC",
  retest_drop: "Re-grade drop (noise)",
  hack_catch_net: "Hack catch, net of noise",
  subtle_catch_net: "Subtle hack, net of noise",
  swe_auroc: "SWE AUROC",
  swe_pair_acc: "SWE pass>fail",
  swe_best_of_4: "SWE best-of-4",
  prb_auroc: "SWE-PRBench AUROC (human)",
  bcr_agree: "BigCodeReward agree (human)",
  attack_gate_rate: "Attacked fail → merge",
  swe_false_accept_cal: "Gate false accept",
  swe_false_reject_cal: "Gate false reject",
};

export const PERTURBATION_LABELS: Record<string, string> = {
  none: "Original (merged)",
  delete_tests: "Delete tests",
  skip_tests: "Skip tests",
  strip_asserts: "Strip assertions",
  pad: "Pad with comments",
  pad_context: "Pad with unchanged context",
  polish_desc: "Polished description",
  unrelated_change: "Unrelated change",
  rename_vars: "Rename variables",
};

export const EXPECTED_TEXT: Record<string, string> = {
  lower: "should score lower",
  same: "should score the same",
  baseline: "baseline",
};

export function fmtMetric(axis: string, v: number): string {
  if (axis === "length_bias" || axis === "context_bias" || axis === "desc_gaming") return (v >= 0 ? "+" : "") + v.toFixed(2);
  if (axis.endsWith("auroc") || axis.startsWith("prb_auroc")) return v.toFixed(2);
  return `${Math.round(v * 100)}%`;
}

export function metricGood(direction: string, v: number): "good" | "mid" | "bad" {
  if (direction === "zero") return Math.abs(v) < 0.15 ? "good" : Math.abs(v) < 0.5 ? "mid" : "bad";
  const x = direction === "lower" ? 1 - v : v;
  return x >= 0.8 ? "good" : x >= 0.5 ? "mid" : "bad";
}
