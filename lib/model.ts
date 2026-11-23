// radar-4 — the token-radar-01 value model, fitted on the snapshot itself.
//
// Everything below is computed at run time from the snapshot handed to
// buildRadar. No protocol name, slug, coefficient or ranking is hardcoded.
//
// What changed from radar-3 (v2), and why — each change was tested
// out of sample in Python before it was adopted here, on the same 128
// live-token protocols, and the numbers are in the dashboard:
//   1. Category shrinkage is heavier: the per-category median residual
//      is now shrunk toward 0 with 20 pseudo-counts instead of 5.
//      Tested properly — the adjustment refitted inside every fold,
//      not on the full data — v2's pipeline (pseudo 5) scores LOO
//      1.351 / 5-fold 1.291 / walk-forward 1.164 median abs log error,
//      while pseudo 20 scores 1.209 / 1.242 / 1.088. v2's published
//      LOO of 1.223 was the bare log-log curve only, without the
//      category adjustment; the full v2 pipeline was worse than that.
//      Heavier shrinkage is what makes the category term help instead
//      of hurt. (Spline, quadratic, chain-count and age terms for the
//      size curve were also tested and all lost out of sample, so the
//      curve stays plain log-log.)
//   2. Launch odds are a smooth ridge logistic regression on all 758
//      protocols — P(still pre-token) from log TVL and log(1 + age) —
//      instead of age buckets multiplied by TVL and growth bucket
//      factors. On 5-fold cross-validation the logistic scores
//      log-loss 0.643 and AUC 0.715, against the bucket method's
//      0.642 and 0.668: same calibration, much better ranking. The
//      fitted age coefficient is negative, so the odds still fall
//      with no-token age, smoothly instead of in steps. Growth is
//      not in the odds: it is already in the launch value, and a
//      growth term in the odds did not improve ranking.
//   3. The out-of-sample tests in fitLogLog now test the WHOLE
//      pipeline — size curve + category adjustment + growth — with
//      every component refitted inside each fold, so the numbers the
//      dashboard shows are the numbers the board actually delivers,
//      not the bare curve's. A bare-curve column is kept alongside
//      for comparison.
//   4. Launch value. launch = exp(intercept + slope * ln(TVL) + adj)
//      * growth multiplier, where growth is the 7-day TVL change
//      clamped to [-50, 100]% and the multiplier is
//      1 + 0.40 * clamped / 100 (unchanged from v2: a fixed 0.40
//      beat a fitted growth coefficient out of sample).
//   5. Farm economics are unchanged from v2. A farmer's expected
//      value is implied * 0.10 (a stated 10% farmer share) divided
//      by a stated farmer count: 500 farmers for rank 1, +10 per
//      rank. Cost is capital (by TVL) + gas + time charged at
//      $25/hour. Net = value - cost. Verdict: SKIP if net <= $0,
//      THIN if $0 < net <= $250, FARM otherwise.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-4';

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  residual_pseudo: number;
  residual_clamp: number;
  odds_smooth_pseudo: number;
  odds_floor: number;
  odds_cap: number;
  factor_floor: number;
  factor_cap: number;
  odds_logistic_lambda: number;
  odds_logistic_iterations: number;
  odds_logistic_lr: number;
  odds_age_null_days: number;
  farmer_share: number;
  hourly_rate_usd: number;
  farmers_base: number;
  farmers_per_rank: number;
  thin_net_max_usd: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  residual_pseudo: 20,
  residual_clamp: 1.0,
  odds_smooth_pseudo: 20,
  odds_floor: 0.05,
  odds_cap: 0.95,
  factor_floor: 0.85,
  factor_cap: 1.15,
  odds_logistic_lambda: 10,
  odds_logistic_iterations: 600,
  odds_logistic_lr: 0.05,
  odds_age_null_days: 1000,
  farmer_share: 0.1,
  hourly_rate_usd: 25,
  farmers_base: 500,
  farmers_per_rank: 10,
  thin_net_max_usd: 250,
};

export const LIVE_ROWS = 24;
export const WALK_FORWARD_CUTOFF = '2024-06-01';

export interface FitResult {
  n: number;
  slope: number;
  intercept: number;
  r_squared: number;
  in_sample_median_abs_log_err: number;
  flat_median_ratio: number;
  flat_median_abs_log_err: number;
  loo_median_abs_log_err: number;
  loo_mean_abs_log_err: number;
  five_fold_median_abs_log_err: number;
  five_fold_mean_abs_log_err: number;
  walk_forward_train_n: number;
  walk_forward_test_n: number;
  walk_forward_slope: number;
  walk_forward_intercept: number;
  walk_forward_median_abs_log_err: number;
  walk_forward_flat_median_abs_log_err: number;
  walk_forward_factor: number;
  loo_factor_vs_flat: number;
  /** Bare log-log curve (no category adjustment, no growth), same tests. */
  bare_loo_median_abs_log_err: number;
  bare_five_fold_median_abs_log_err: number;
  bare_walk_forward_median_abs_log_err: number;
}

export interface OddsBucket {
  label: string;
  n: number;
  pre_token_share: number;
  smoothed_odds: number;
}

export interface OddsFit {
  overall_pre_token_share: number;
  age_buckets: OddsBucket[];
  age_odds: number[];
  tvl_buckets: OddsBucket[];
  growth_buckets: OddsBucket[];
  /** Ridge logistic regression P(still pre-token) from log TVL and log(1+age). */
  logistic_intercept: number;
  logistic_weights: number[];
  logistic_mean: number[];
  logistic_sd: number[];
  logistic_age_weight: number;
  logistic_tvl_weight: number;
  /** Median logistic odds per age bucket, for the dashboard's odds table. */
  age_bucket_logistic_median: number[];
  /** 5-fold (slug-hash) cross-validation of the odds, computed in code. */
  logistic_cv_logloss: number;
  logistic_cv_auc: number;
  bucket_cv_logloss: number;
  bucket_cv_auc: number;
}

export interface FarmEconomics {
  verdict: 'FARM' | 'THIN' | 'SKIP';
  farm_value_usd: number;
  farm_cost_usd: number;
  net_usd: number;
  value_per_hour_usd: number;
  total_hours: number;
  farmers: number;
  break_even_farmers: number;
  change_line: string;
}

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  launch_odds: number;
  model: {
    category_log_adj: number;
    category_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    launch_value_usd: number;
    launch_odds: number;
    odds_logistic: number;
    odds_age_median: number;
    age_days: number | null;
  };
  farm: FarmEconomics;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  launch_value_usd: number;
  launch_odds: number;
  category_log_adj: number;
  category_factor: number;
  growth_pct: number;
  growth_multiplier: number;
  odds_logistic: number;
  odds_age_median: number;
  farm: FarmEconomics;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface CensusEntry {
  slug: string;
  name: string;
  reason: string;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_total: number;
  census_total: number;
  excluded_size: number;
  fit: FitResult;
  odds: OddsFit;
  category_log_adj: Record<string, number>;
  category_n: Record<string, number>;
  verdict_counts: { FARM: number; THIN: number; SKIP: number };
  rows: RadarRow[];
  live: LiveRow[];
  excluded: CensusEntry[];
  excluded_by_reason: Record<string, number>;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** FNV-1a hash, for the deterministic 5-fold split by slug. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function ols(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** Usable live-token protocols for the size fit: a positive market cap and TVL. */
export function fitProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
}

/** Predict log(mcap) for test protocols from a training set, with the
 *  whole pipeline refitted on the training set only: OLS log-log, the
 *  shrunk category median residual, and the fixed growth term (in log
 *  space, log(1 + 0.40 * clamped/100)). With useCategory and useGrowth
 *  false this is the bare curve. Every out-of-sample test below calls
 *  this, so no component ever sees the protocol it predicts. */
export function predictLogMcap(
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  model: ModelConstants,
  useCategory: boolean,
  useGrowth: boolean,
): number[] {
  const xs = train.map((p) => Math.log(p.tvl_usd));
  const ys = train.map((p) => Math.log(p.mcap_usd!));
  const f = ols(xs, ys);
  const adj = new Map<string, number>();
  if (useCategory) {
    const byCat = new Map<string, number[]>();
    for (let i = 0; i < train.length; i++) {
      const r = ys[i]! - (f.intercept + f.slope * xs[i]!);
      const key = train[i]!.category ?? 'Uncategorised';
      const arr = byCat.get(key) ?? [];
      arr.push(r);
      byCat.set(key, arr);
    }
    for (const [cat, arr] of byCat) {
      const med = median(arr);
      adj.set(cat, clamp((arr.length * med) / (arr.length + model.residual_pseudo), -model.residual_clamp, model.residual_clamp));
    }
  }
  return test.map((p) => {
    const g = useGrowth
      ? Math.log(1 + (clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap) / 100) * model.growth_weight)
      : 0;
    return f.intercept + f.slope * Math.log(p.tvl_usd) + (adj.get(p.category ?? 'Uncategorised') ?? 0) + g;
  });
}

function absLogErrs(pred: number[], test: SnapshotProtocol[]): number[] {
  return pred.map((pr, i) => Math.abs(Math.log(test[i]!.mcap_usd!) - pr));
}

export function fitLogLog(snapshot: Snapshot): FitResult {
  const live = fitProtocols(snapshot);
  const xs = live.map((p) => Math.log(p.tvl_usd));
  const ys = live.map((p) => Math.log(p.mcap_usd!));
  const { slope, intercept } = ols(xs, ys);
  const my = mean(ys);
  const pred = xs.map((x) => slope * x + intercept);
  const res = ys.map((y, i) => y - pred[i]!);
  const ssRes = res.reduce((a, r) => a + r * r, 0);
  const ssTot = ys.reduce((a, y) => a + (y - my) * (y - my), 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const flatRatio = median(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const flatErr = ys.map((y, i) => Math.abs(y - (Math.log(flatRatio) + xs[i]!)));
  const flatMed = median(flatErr);
  // Leave-one-out: refit the whole pipeline without each point in turn.
  const looErr = absLogErrs(
    live.flatMap((_, i) => predictLogMcap(live.filter((__, j) => j !== i), [live[i]!], MODEL, true, true)),
    live,
  );
  const bareLooErr = absLogErrs(
    live.flatMap((_, i) => predictLogMcap(live.filter((__, j) => j !== i), [live[i]!], MODEL, false, false)),
    live,
  );
  // 5-fold, deterministic by slug hash.
  const foldErr: number[] = [];
  const bareFoldErr: number[] = [];
  for (let k = 0; k < 5; k++) {
    const te = live.filter((p) => fnv1a(p.slug) % 5 === k);
    const tr = live.filter((p) => fnv1a(p.slug) % 5 !== k);
    if (te.length === 0 || tr.length < 3) continue;
    foldErr.push(...absLogErrs(predictLogMcap(tr, te, MODEL, true, true), te));
    bareFoldErr.push(...absLogErrs(predictLogMcap(tr, te, MODEL, false, false), te));
  }
  // Walk-forward: train on protocols first tracked before the cutoff, test on the rest.
  const train = live.filter((p) => p.listed_at !== null && p.listed_at < WALK_FORWARD_CUTOFF);
  const test = live.filter((p) => p.listed_at !== null && p.listed_at >= WALK_FORWARD_CUTOFF);
  let wfSlope = slope;
  let wfIntercept = intercept;
  let wfMed = 0;
  let wfFlatMed = 0;
  let bareWfMed = 0;
  if (train.length >= 3 && test.length > 0) {
    const f = ols(
      train.map((p) => Math.log(p.tvl_usd)),
      train.map((p) => Math.log(p.mcap_usd!)),
    );
    wfSlope = f.slope;
    wfIntercept = f.intercept;
    wfMed = median(absLogErrs(predictLogMcap(train, test, MODEL, true, true), test));
    bareWfMed = median(absLogErrs(predictLogMcap(train, test, MODEL, false, false), test));
    const flatTrain = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    wfFlatMed = median(test.map((p) => Math.abs(Math.log(p.mcap_usd!) - (Math.log(flatTrain) + Math.log(p.tvl_usd)))));
  }
  const looMed = median(looErr);
  const inSampleFull = median(absLogErrs(predictLogMcap(live, live, MODEL, true, true), live));
  return {
    n: live.length,
    slope: round4(slope),
    intercept: round4(intercept),
    r_squared: round4(r2),
    in_sample_median_abs_log_err: round4(inSampleFull),
    flat_median_ratio: round4(flatRatio),
    flat_median_abs_log_err: round4(flatMed),
    loo_median_abs_log_err: round4(looMed),
    loo_mean_abs_log_err: round4(mean(looErr)),
    five_fold_median_abs_log_err: round4(median(foldErr)),
    five_fold_mean_abs_log_err: round4(mean(foldErr)),
    walk_forward_train_n: train.length,
    walk_forward_test_n: test.length,
    walk_forward_slope: round4(wfSlope),
    walk_forward_intercept: round4(wfIntercept),
    walk_forward_median_abs_log_err: round4(wfMed),
    walk_forward_flat_median_abs_log_err: round4(wfFlatMed),
    walk_forward_factor: wfMed > 0 ? round4(wfFlatMed / wfMed) : 0,
    loo_factor_vs_flat: looMed > 0 ? round4(flatMed / looMed) : 0,
    bare_loo_median_abs_log_err: round4(median(bareLooErr)),
    bare_five_fold_median_abs_log_err: round4(median(bareFoldErr)),
    bare_walk_forward_median_abs_log_err: round4(bareWfMed),
  };
}

/** Median log residual per category, shrunk toward 0, clamped to [-1, 1]. */
export function categoryLogAdj(
  snapshot: Snapshot,
  fit: { slope: number; intercept: number },
  model: ModelConstants = MODEL,
): { byCategory: Map<string, number>; counts: Map<string, number> } {
  const live = fitProtocols(snapshot);
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const r = Math.log(p.mcap_usd!) - (fit.intercept + fit.slope * Math.log(p.tvl_usd));
    const key = p.category ?? 'Uncategorised';
    const arr = byCat.get(key) ?? [];
    arr.push(r);
    byCat.set(key, arr);
  }
  const out = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const [cat, arr] of byCat) {
    const med = median(arr);
    const shrunk = (arr.length * med) / (arr.length + model.residual_pseudo);
    out.set(cat, round4(clamp(shrunk, -model.residual_clamp, model.residual_clamp)));
    counts.set(cat, arr.length);
  }
  return { byCategory: out, counts };
}

const AGE_LABELS = ['<180d', '180–365d', '365–730d', '>730d'];
const TVL_LABELS = ['$5–50M', '$50–200M', '$200M–$1B', '>$1B'];
const GROWTH_LABELS = ['<−10%', '−10–0%', '0–10%', '10–50%', '>50%'];

function ageBucket(age: number | null): number {
  if (age === null) return -1;
  if (age < 180) return 0;
  if (age < 365) return 1;
  if (age < 730) return 2;
  return 3;
}

function tvlBucket(tvl: number): number {
  if (tvl < 50_000_000) return 0;
  if (tvl < 200_000_000) return 1;
  if (tvl < 1_000_000_000) return 2;
  return 3;
}

function growthBucket(g: number | null): number {
  if (g === null) return -1;
  if (g < -10) return 0;
  if (g < 0) return 1;
  if (g < 10) return 2;
  if (g < 50) return 3;
  return 4;
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

function sigmoid(z: number): number {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

function logisticFeatures(p: SnapshotProtocol, asOf: string, model: ModelConstants): number[] {
  const age = ageDays(asOf, p.listed_at);
  return [Math.log(p.tvl_usd), Math.log1p(age ?? model.odds_age_null_days)];
}

/** Ridge logistic regression P(still pre-token) on standardised
 *  [log TVL, log(1+age)], fitted by plain gradient descent (fixed
 *  step and iteration count, so the fit is deterministic). L2 penalty
 *  lambda applies to the weights only, never the intercept. */
export function fitLogisticOdds(
  protocols: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants = MODEL,
): { intercept: number; weights: number[]; mean: number[]; sd: number[] } {
  const xs = protocols.map((p) => logisticFeatures(p, asOf, model));
  const ys = protocols.map((p) => (isPreToken(p) ? 1 : 0));
  const n = protocols.length;
  const featMean = [0, 1].map((j) => xs.reduce((a, r) => a + r[j]!, 0) / n);
  const sd = [0, 1].map((j) => {
    const v = xs.reduce((a, r) => a + (r[j]! - featMean[j]!) * (r[j]! - featMean[j]!), 0) / n;
    return Math.sqrt(v) || 1;
  });
  const z = xs.map((r) => [(r[0]! - featMean[0]!) / sd[0]!, (r[1]! - featMean[1]!) / sd[1]!]);
  const base = mean(ys);
  let intercept = Math.log(base / (1 - base));
  let weights = [0, 0];
  for (let it = 0; it < model.odds_logistic_iterations; it++) {
    let gw0 = 0;
    let gw1 = 0;
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const pr = sigmoid(intercept + weights[0]! * z[i]![0]! + weights[1]! * z[i]![1]!);
      const d = pr - ys[i]!;
      gw0 += (d * z[i]![0]!) / n;
      gw1 += (d * z[i]![1]!) / n;
      gb += d / n;
    }
    weights = [
      weights[0]! - model.odds_logistic_lr * (gw0 + (model.odds_logistic_lambda * weights[0]!) / n),
      weights[1]! - model.odds_logistic_lr * (gw1 + (model.odds_logistic_lambda * weights[1]!) / n),
    ];
    intercept -= model.odds_logistic_lr * gb;
  }
  return { intercept: round4(intercept), weights: weights.map(round4), mean: featMean.map(round4), sd: sd.map(round4) };
}

function logisticProb(
  p: SnapshotProtocol,
  asOf: string,
  fit: { intercept: number; weights: number[]; mean: number[]; sd: number[] },
  model: ModelConstants,
): number {
  const f = logisticFeatures(p, asOf, model);
  const z0 = (f[0]! - fit.mean[0]!) / fit.sd[0]!;
  const z1 = (f[1]! - fit.mean[1]!) / fit.sd[1]!;
  return sigmoid(fit.intercept + fit.weights[0]! * z0 + fit.weights[1]! * z1);
}

function logLoss(pred: number[], labels: number[]): number {
  let s = 0;
  for (let i = 0; i < pred.length; i++) {
    const pr = clamp(pred[i]!, 1e-6, 1 - 1e-6);
    s += labels[i]! === 1 ? Math.log(pr) : Math.log(1 - pr);
  }
  return round4(-s / pred.length);
}

/** AUC by average ranks (Mann-Whitney), ties averaged. */
function aucScore(pred: number[], labels: number[]): number {
  const order = pred.map((_, i) => i).sort((a, b) => pred[a]! - pred[b]!);
  const ranks = new Array<number>(pred.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && pred[order[j + 1]!] === pred[order[i]!]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!] = avg;
    i = j + 1;
  }
  const n1 = labels.reduce((a, l) => a + l, 0);
  const n0 = labels.length - n1;
  if (n1 === 0 || n0 === 0) return 0;
  let sum = 0;
  for (let k = 0; k < labels.length; k++) if (labels[k] === 1) sum += ranks[k]!;
  return round4((sum - (n1 * (n1 + 1)) / 2) / (n1 * n0));
}

/** v2's bucket odds for one protocol, with the buckets fitted on the
 *  given training protocols only. Used only for the odds cross-
 *  validation below, so the bucket method and the logistic are
 *  compared on the same held-out folds. */
function bucketOddsFor(train: SnapshotProtocol[], p: SnapshotProtocol, asOf: string, model: ModelConstants): number {
  const overall = train.filter(isPreToken).length / train.length;
  const rawShare = (assign: (q: SnapshotProtocol) => number, k: number): number => {
    const arr = train.filter((q) => assign(q) === k);
    return arr.length === 0 ? overall : arr.filter(isPreToken).length / arr.length;
  };
  const ageB = [0, 1, 2, 3].map((k) => {
    const arr = train.filter((q) => ageBucket(ageDays(asOf, q.listed_at)) === k);
    const raw = arr.length === 0 ? overall : arr.filter(isPreToken).length / arr.length;
    return (arr.length * raw + model.odds_smooth_pseudo * overall) / (arr.length + model.odds_smooth_pseudo);
  });
  let running = 1;
  const ageOdds = ageB.map((v) => {
    running = Math.min(running, v);
    return running;
  });
  const ab = ageBucket(ageDays(asOf, p.listed_at));
  const ageOdd = ab < 0 ? overall : ageOdds[ab]!;
  const tvlF = clamp(rawShare((q) => tvlBucket(q.tvl_usd), tvlBucket(p.tvl_usd)) / overall, model.factor_floor, model.factor_cap);
  const gb = growthBucket(p.change_7d);
  const growthF = gb < 0 ? 1 : clamp(rawShare((q) => growthBucket(q.change_7d), gb) / overall, model.factor_floor, model.factor_cap);
  return clamp(ageOdd * tvlF * growthF, model.odds_floor, model.odds_cap);
}

/** Launch odds fitted from the snapshot's own record. See the header comment. */
export function fitLaunchOdds(snapshot: Snapshot, model: ModelConstants = MODEL): OddsFit {
  const total = snapshot.protocols.length;
  const overall = snapshot.protocols.filter(isPreToken).length / total;
  const mkBuckets = (labels: string[], assign: (p: SnapshotProtocol) => number): OddsBucket[] => {
    const buckets: SnapshotProtocol[][] = labels.map(() => []);
    for (const p of snapshot.protocols) {
      const b = assign(p);
      if (b >= 0) buckets[b]!.push(p);
    }
    return labels.map((label, i) => {
      const arr = buckets[i]!;
      const raw = arr.length === 0 ? overall : arr.filter(isPreToken).length / arr.length;
      const smoothed = (arr.length * raw + model.odds_smooth_pseudo * overall) / (arr.length + model.odds_smooth_pseudo);
      return { label, n: arr.length, pre_token_share: round4(raw), smoothed_odds: round4(smoothed) };
    });
  };
  const ageBuckets = mkBuckets(AGE_LABELS, (p) => ageBucket(ageDays(snapshot.as_of, p.listed_at)));
  // Isotonic: odds must not rise with age — take the running minimum.
  const ageOdds: number[] = [];
  let running = 1;
  for (const b of ageBuckets) {
    running = Math.min(running, b.smoothed_odds);
    ageOdds.push(round4(running));
  }
  const tvlBuckets = mkBuckets(TVL_LABELS, (p) => tvlBucket(p.tvl_usd));
  const growthBuckets = mkBuckets(GROWTH_LABELS, (p) => growthBucket(p.change_7d));
  // The logistic odds, fitted on all 758 protocols.
  const logFit = fitLogisticOdds(snapshot.protocols, snapshot.as_of, model);
  const logistic = snapshot.protocols.map((p) => logisticProb(p, snapshot.as_of, logFit, model));
  const ageMedian: number[] = [0, 1, 2, 3].map((k) => {
    const vals = snapshot.protocols
      .filter((p) => ageBucket(ageDays(snapshot.as_of, p.listed_at)) === k)
      .map((p) => logisticProb(p, snapshot.as_of, logFit, model));
    return round4(median(vals));
  });
  // 5-fold cross-validation (deterministic, by slug hash) of both odds
  // methods on the same folds: log-loss and AUC.
  const labels = snapshot.protocols.map((p) => (isPreToken(p) ? 1 : 0));
  const logPred: number[] = new Array(snapshot.protocols.length).fill(0);
  const buckPred: number[] = new Array(snapshot.protocols.length).fill(0);
  for (let k = 0; k < 5; k++) {
    const te = snapshot.protocols.filter((p) => fnv1a(p.slug) % 5 === k);
    const tr = snapshot.protocols.filter((p) => fnv1a(p.slug) % 5 !== k);
    if (te.length === 0 || tr.length < 3) continue;
    const f = fitLogisticOdds(tr, snapshot.as_of, model);
    for (const p of te) {
      const idx = snapshot.protocols.indexOf(p);
      logPred[idx] = logisticProb(p, snapshot.as_of, f, model);
      buckPred[idx] = bucketOddsFor(tr, p, snapshot.as_of, model);
    }
  }
  return {
    overall_pre_token_share: round4(overall),
    age_buckets: ageBuckets,
    age_odds: ageOdds,
    tvl_buckets: tvlBuckets,
    growth_buckets: growthBuckets,
    logistic_intercept: logFit.intercept,
    logistic_weights: logFit.weights,
    logistic_mean: logFit.mean,
    logistic_sd: logFit.sd,
    logistic_age_weight: logFit.weights[1]!,
    logistic_tvl_weight: logFit.weights[0]!,
    age_bucket_logistic_median: ageMedian,
    logistic_cv_logloss: logLoss(logPred, labels),
    logistic_cv_auc: aucScore(logPred, labels),
    bucket_cv_logloss: logLoss(buckPred, labels),
    bucket_cv_auc: aucScore(buckPred, labels),
  };
}

export function oddsFor(
  p: SnapshotProtocol,
  asOf: string,
  odds: OddsFit,
  model: ModelConstants = MODEL,
): { odds: number; logisticOdds: number; ageMedian: number } {
  const logFit = {
    intercept: odds.logistic_intercept,
    weights: odds.logistic_weights,
    mean: odds.logistic_mean,
    sd: odds.logistic_sd,
  };
  const lp = logisticProb(p, asOf, logFit, model);
  const ab = ageBucket(ageDays(asOf, p.listed_at));
  const ageMedian = ab < 0 ? odds.overall_pre_token_share : odds.age_bucket_logistic_median[ab]!;
  const o = clamp(lp, model.odds_floor, model.odds_cap);
  return { odds: round4(o), logisticOdds: round4(lp), ageMedian: round4(ageMedian) };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isEligible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** One-line reason a pre-token protocol is not on the ranked board. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return null;
  if (isEligible(p)) return null;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked word in name';
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return 'exchange-named';
  return 'excluded';
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open, borrowing only a small share against it.`;
  if (c.includes('dex') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through fee cycles.`;
  if (c.includes('yield') || c.includes('farm'))
    return `Deposit $${capital} of USDC into ${name}'s main yield vault on ${chain} and let it compound.`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('basis'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction'))
    return `Fund $${capital} on ${name} and place one market position, then hold it to settlement.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk curator') || c.includes('onchain capital'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares for the full hold period.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('nft'))
    return `Use $${capital} to mint or trade one listed item through ${name} on ${chain}.`;
  if (c.includes('ai'))
    return `Spend $${capital} on compute or a task through ${name} on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

export function farmEconomics(
  implied: number,
  rank: number,
  capital: number,
  hold: number,
  model: ModelConstants = MODEL,
): FarmEconomics {
  const farmers = model.farmers_base + model.farmers_per_rank * rank;
  const weeks = Math.ceil(hold / 7);
  const gas = (capital >= 150 ? 8 : 4) + 2 * weeks;
  const totalHours = round2(0.25 + (10 / 60) * weeks + 10 / 60 + 5 / 60);
  const cost = round2(capital + gas + totalHours * model.hourly_rate_usd);
  const value = round2((implied * model.farmer_share) / farmers);
  const net = round2(value - cost);
  const vph = round2(value / totalHours);
  const verdict: FarmEconomics['verdict'] = net <= 0 ? 'SKIP' : net <= model.thin_net_max_usd ? 'THIN' : 'FARM';
  const breakEven = cost > 0 ? Math.floor((implied * model.farmer_share) / cost) : 0;
  const changeLine =
    verdict === 'FARM'
      ? `If farmers rose past ${breakEven.toLocaleString('en-US')}, the net would turn negative and this would become SKIP.`
      : verdict === 'THIN'
        ? `A small rise in farmers, or a fall in the farmer share to 5%, would flip this to SKIP; a fall in farmers to ${breakEven.toLocaleString('en-US')} would make it FARM.`
        : `Needs fewer than ${breakEven.toLocaleString('en-US')} farmers to break even; at ${farmers.toLocaleString('en-US')} farmers it is $${Math.abs(net).toLocaleString('en-US')} under.`;
  return {
    verdict,
    farm_value_usd: value,
    farm_cost_usd: cost,
    net_usd: net,
    value_per_hour_usd: vph,
    total_hours: totalHours,
    farmers,
    break_even_farmers: breakEven,
    change_line: changeLine,
  };
}

/** Six farm steps, the fifth being the verdict check for this row. */
export function farmSteps(p: SnapshotProtocol, age: number | null, farm: FarmEconomics): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  const weeks = Math.ceil(hold / 7);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: action, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    {
      text: `Make one qualifying action each week on ${p.name}, such as a deposit, a borrow, a swap or a vote`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the verdict before you commit more capital: this row is ${farm.verdict}, net $${farm.net_usd.toLocaleString('en-US')} at $${farm.value_per_hour_usd.toLocaleString('en-US')} an hour with ${farm.farmers.toLocaleString('en-US')} farmers. ${farm.change_line}`,
      cost: 'nothing to check',
      time: '5 minutes',
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page, claim only from the link it publishes, and write the wallet, the dates and every transaction in a farm log`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  const LIVE_EXCLUDED = new Set(['CEX', 'Bridge', 'Canonical Bridge']);
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && !(p.category !== null && LIVE_EXCLUDED.has(p.category)))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitLogLog(snapshot);
  const { byCategory: adjMap } = categoryLogAdj(snapshot, fit, model);
  const odds = fitLaunchOdds(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && isEligible(p)) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isEligible(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const logAdj = adjMap.get(p.category ?? 'Uncategorised') ?? 0;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const rawGrowth = finite(p.change_7d, 0);
    const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
    const growthMult = 1 + (growthPct / 100) * model.growth_weight;
    const launch = Math.exp(fit.intercept + fit.slope * Math.log(p.tvl_usd) + logAdj) * growthMult;
    const o = oddsFor(p, snapshot.as_of, odds, model);
    const implied = Math.max(1, Math.round(launch * o.odds));
    return { p, logAdj, age, growthPct, growthMult, launch, odds: o, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const rank = i + 1;
    const capital = capitalFor(s.p);
    const hold = holdDaysFor(s.age);
    const farm = farmEconomics(s.implied, rank, capital, hold, model);
    return {
      rank,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      implied_value_usd: s.implied,
      launch_value_usd: Math.max(1, Math.round(s.launch)),
      launch_odds: s.odds.odds,
      model: {
        category_log_adj: s.logAdj,
        category_factor: round4(Math.exp(s.logAdj)),
        growth_pct: round4(s.growthPct),
        growth_multiplier: round4(s.growthMult),
        launch_value_usd: Math.max(1, Math.round(s.launch)),
        launch_odds: s.odds.odds,
        odds_logistic: s.odds.logisticOdds,
        odds_age_median: s.odds.ageMedian,
        age_days: s.age,
      },
      farm,
      farm_steps: farmSteps(s.p, s.age, farm).map(stepText),
    };
  });
}

function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_value_usd: row.launch_value_usd,
    launch_odds: row.launch_odds,
    category_log_adj: row.model.category_log_adj,
    category_factor: row.model.category_factor,
    growth_pct: row.model.growth_pct,
    growth_multiplier: row.model.growth_multiplier,
    odds_logistic: row.model.odds_logistic,
    odds_age_median: row.model.odds_age_median,
    farm: row.farm,
    farm_steps: row.farm_steps,
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const fit = fitLogLog(snapshot);
  const odds = fitLaunchOdds(snapshot, model);
  const { byCategory: adjMap, counts } = categoryLogAdj(snapshot, fit, model);
  const excluded: CensusEntry[] = [];
  const excludedByReason: Record<string, number> = {};
  for (const p of snapshot.protocols) {
    const reason = exclusionReason(p);
    if (reason !== null) {
      excluded.push({ slug: p.slug, name: p.name, reason });
      excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
    }
  }
  excluded.sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const verdictCounts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdictCounts[r.farm.verdict]++;
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const catAdj: Record<string, number> = {};
  for (const [k, v] of [...adjMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) catAdj[k] = v;
  const catN: Record<string, number> = {};
  for (const [k, v] of [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) catN[k] = v;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    live_total: snapshot.protocols.filter((p) => !isPreToken(p)).length,
    census_total: snapshot.protocols.length,
    excluded_size: excluded.length,
    fit,
    odds,
    category_log_adj: catAdj,
    category_n: catN,
    verdict_counts: verdictCounts,
    rows: board.map(radarRow),
    live,
    excluded,
    excluded_by_reason: excludedByReason,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board has ${board.length} rows, fewer than 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
