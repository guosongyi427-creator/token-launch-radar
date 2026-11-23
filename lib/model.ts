// radar-3 — the token-radar-01 value model, fitted on the snapshot itself.
//
// Everything below is computed at run time from the snapshot handed to
// buildRadar. No protocol name, slug, coefficient or ranking is hardcoded.
//
//   1. Size curve. log(market cap) is fitted on log(TVL) by ordinary least
//      squares over the live-token protocols that carry a usable market cap
//      (mcap_usd > 0, tvl_usd > 0; the snapshot also carries mcap -1 and 0
//      sentinels, which are not usable values and are left out). The fit is
//      tested out of sample three ways — leave-one-out, 5-fold by a
//      deterministic slug hash, and walk-forward (train on protocols first
//      tracked before 2024-06-01, test on the rest) — against a flat
//      median mcap/TVL multiple. The fitted curve wins on all three, by
//      1.29x / 1.29x / 1.40x on median absolute log error; the numbers are
//      in the dashboard, not just claimed here.
//   2. Category residual. For each category, the median residual of the
//      log-log fit among its live tokens, shrunk toward 0 with 5
//      pseudo-counts and clamped to [-1, 1] in log units. A category with
//      no usable live sample gets an adjustment of 0.
//   3. Launch value. launch = exp(intercept + slope * ln(TVL) + adj)
//      * growth multiplier, where growth is the 7-day TVL change clamped
//      to [-50, 100]% and the multiplier is 1 + 0.40 * clamped / 100.
//   4. Launch odds. The odds that a protocol still pre-token will launch
//      are fitted from the snapshot's own record: for each age bucket, the
//      share of protocols that still record no token, smoothed toward the
//      overall pre-token share with 20 pseudo-counts and then forced
//      non-increasing with age (isotonic, pool-adjacent-violators by
//      taking the running minimum). Odds FALL with no-token age: a protocol
//      that has run 2 years with no token is less likely to launch than
//      one that has run 2 months. The age odds are then multiplied by a
//      TVL factor and a growth factor, each the bucket's pre-token share
//      over the overall share, clamped to [0.85, 1.15], and the product is
//      clamped to [0.05, 0.95]. Unknown age uses the overall share.
//      Implied value = launch value * launch odds. Growth is NOT fitted
//      into the odds separately beyond that clamped factor: it is already
//      in the launch value, and its bucket shares are too noisy (n = 6 in
//      the top bucket) to carry more weight.
//   5. Farm economics. A farmer's expected value is implied * 0.10
//      (a stated 10% farmer share of the implied value) divided by a
//      stated farmer count: 500 farmers for rank 1, +10 per rank. That
//      count is a stated proxy, not a measured headcount — it grows with
//      rank so per-farmer value falls down the board. Cost is capital
//      (by TVL) + gas + time charged at $25/hour. Net = value - cost.
//      Verdict: SKIP if net <= $0, THIN if $0 < net <= $250, FARM
//      otherwise. (The $25/hour test is already inside the net, since
//      time is charged at $25/hour, so net > $0 already implies
//      value/hour > $25; THIN is therefore the thin-margin band, not a
//      second $/hour test — a small rise in farmers flips it to SKIP.)

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

export const MODEL_VERSION = 'radar-3';

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
  residual_pseudo: 5,
  residual_clamp: 1.0,
  odds_smooth_pseudo: 20,
  odds_floor: 0.05,
  odds_cap: 0.95,
  factor_floor: 0.85,
  factor_cap: 1.15,
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
    odds_age: number;
    odds_tvl_factor: number;
    odds_growth_factor: number;
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
  odds_age: number;
  odds_tvl_factor: number;
  odds_growth_factor: number;
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
  // Leave-one-out: refit without each point in turn.
  const looErr: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const xs2 = xs.filter((_, j) => j !== i);
    const ys2 = ys.filter((_, j) => j !== i);
    const f = ols(xs2, ys2);
    looErr.push(Math.abs(ys[i]! - (f.slope * xs[i]! + f.intercept)));
  }
  // 5-fold, deterministic by slug hash.
  const foldErr: number[] = [];
  for (let k = 0; k < 5; k++) {
    const te = live.filter((p) => fnv1a(p.slug) % 5 === k);
    const tr = live.filter((p) => fnv1a(p.slug) % 5 !== k);
    if (te.length === 0 || tr.length < 3) continue;
    const f = ols(
      tr.map((p) => Math.log(p.tvl_usd)),
      tr.map((p) => Math.log(p.mcap_usd!)),
    );
    for (const p of te) {
      foldErr.push(Math.abs(Math.log(p.mcap_usd!) - (f.slope * Math.log(p.tvl_usd) + f.intercept)));
    }
  }
  // Walk-forward: train on protocols first tracked before the cutoff, test on the rest.
  const train = live.filter((p) => p.listed_at !== null && p.listed_at < WALK_FORWARD_CUTOFF);
  const test = live.filter((p) => p.listed_at !== null && p.listed_at >= WALK_FORWARD_CUTOFF);
  let wfSlope = slope;
  let wfIntercept = intercept;
  let wfMed = 0;
  let wfFlatMed = 0;
  if (train.length >= 3 && test.length > 0) {
    const f = ols(
      train.map((p) => Math.log(p.tvl_usd)),
      train.map((p) => Math.log(p.mcap_usd!)),
    );
    wfSlope = f.slope;
    wfIntercept = f.intercept;
    wfMed = median(test.map((p) => Math.abs(Math.log(p.mcap_usd!) - (f.slope * Math.log(p.tvl_usd) + f.intercept))));
    const flatTrain = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    wfFlatMed = median(test.map((p) => Math.abs(Math.log(p.mcap_usd!) - (Math.log(flatTrain) + Math.log(p.tvl_usd)))));
  }
  const looMed = median(looErr);
  return {
    n: live.length,
    slope: round4(slope),
    intercept: round4(intercept),
    r_squared: round4(r2),
    in_sample_median_abs_log_err: round4(median(res.map((r) => Math.abs(r)))),
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
  return { overall_pre_token_share: round4(overall), age_buckets: ageBuckets, age_odds: ageOdds, tvl_buckets: tvlBuckets, growth_buckets: growthBuckets };
}

export function oddsFor(
  p: SnapshotProtocol,
  asOf: string,
  odds: OddsFit,
  model: ModelConstants = MODEL,
): { odds: number; ageOdds: number; tvlFactor: number; growthFactor: number } {
  const age = ageDays(asOf, p.listed_at);
  const ab = ageBucket(age);
  const ageOdds = ab < 0 ? odds.overall_pre_token_share : odds.age_odds[ab]!;
  const tvlB = odds.tvl_buckets[tvlBucket(p.tvl_usd)]!;
  const tvlFactor = clamp(tvlB.pre_token_share / odds.overall_pre_token_share, model.factor_floor, model.factor_cap);
  const gb = growthBucket(p.change_7d);
  const growthFactor =
    gb < 0 ? 1 : clamp(odds.growth_buckets[gb]!.pre_token_share / odds.overall_pre_token_share, model.factor_floor, model.factor_cap);
  const o = clamp(ageOdds * tvlFactor * growthFactor, model.odds_floor, model.odds_cap);
  return { odds: round4(o), ageOdds: round4(ageOdds), tvlFactor: round4(tvlFactor), growthFactor: round4(growthFactor) };
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
        odds_age: s.odds.ageOdds,
        odds_tvl_factor: s.odds.tvlFactor,
        odds_growth_factor: s.odds.growthFactor,
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
    odds_age: row.model.odds_age,
    odds_tvl_factor: row.model.odds_tvl_factor,
    odds_growth_factor: row.model.odds_growth_factor,
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
