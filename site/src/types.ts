export type Metric = { value: number; lo: number; hi: number; n: number; n_parents: number } | null;

export type JudgeCard = {
  metrics: Record<string, Metric>;
  n_ratings: number;
  n_prefs: number;
  cost_usd_total: number;
  cost_per_rating_usd: number;
  p50_latency_s: number;
  composite: number | null;
  best_of_n?: Record<string, { judge: Metric; random: Metric; oracle: Metric }>;
  goodhart?: Record<string, { score: Metric; pass: Metric; random: Metric }>;
  attack_transfer_src?: string;
  attack_cost_usd?: number;
  swe_cutoff?: number;
};

export type Scorecard = {
  axes: Record<string, { direction: "higher" | "lower" | "zero"; desc: string }>;
  judges: Record<string, JudgeCard>;
  rank_robustness?: Record<string, { top1: number; mean_rank: number; top1_linear: number; axes: string[] }>;
  n_items: number;
  n_pairs: number;
  n_parents: number;
};

export type Failure = {
  judge_id: string;
  item_id: string;
  parent_id: string;
  perturbation: string;
  category: string;
  expected: "lower" | "same";
  parent_r7: number;
  r7: number;
  delta: number;
  reason: string;
  url: string;
};

export type VariantRating = { r7: number; scores: Record<string, number>; reason: string };

export type Variant = {
  id: string;
  perturbation: string;
  category: string;
  expected: "lower" | "same" | "baseline";
  description: string;
  diff: string;
  ratings: Record<string, VariantRating>;
};

export type PlaygroundPR = {
  parent_id: string;
  url: string;
  language: string;
  task: string;
  showcase: boolean;
  variants: Variant[];
};
