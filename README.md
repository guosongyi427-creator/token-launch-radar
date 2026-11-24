# Token Launch Radar — radar-5

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/guosongyi427-creator/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/guosongyi427-creator/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Built for [make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01): Build the best token launch radar.

A token launch radar for make.fun's `token-radar-01` bounty. It reads a
sealed DefiLlama snapshot, ranks the protocols that record no token by an
implied launch value, and hands in a static dashboard with a detail view
and a farm plan for every protocol.

This is v4 (model **radar-5**). It keeps v3's fitted size curve and
fitted logistic odds, and improves both: heavier category shrinkage
(30 pseudo-counts) and a stronger growth weight (0.60) for the value,
and a richer odds model — eight features instead of two, including
the category's own pre-token rate — which lifts the odds'
cross-validated AUC from 0.71 to 0.77. The census of all 758
protocols and the costed farm plans are unchanged in shape.

Note for the repo: the make.fun site recommends adding the About
topics `ai-agents` and `bounties` to the GitHub repository (alongside
the `makefun` topic already set) — do that when the repo is next
updated.

## Run it

```sh
node main.ts --input ../token-radar-01-kit/input/snapshot.json --output out
```

Node 22+ stdlib only. It reads the snapshot, validates the board
(198 rows, watchlist 40/40, ranks 1..198, implied value non-increasing,
6 farm steps of 20–600 characters per row), copies `dashboard/` and
`screenshots/` into the output directory, and writes `board.json`,
`data.js` and `dossier.json` (via `vendor/makefun-board.ts`, copied
unchanged from the kit). Two runs are byte-identical:

```
board.json   0d626fb93bd1dee1b112ec345380d5cecc571c71eca39887148e4b9bb1f1b46a
dossier.json 22906510709be38ddfe59c321145fe269c3b0a279438c886d599f17f6c90ea32
data.js      f84f95870fcc1801ab57af756c3fe481094e21dd2de45a8e5f7ac54e41420229
```

Snapshot: 758 protocols, 40 watchlist, as of 2026-11-14, floor
$50,000,000 TVL, source DefiLlama `https://api.llama.fi/protocols`,
fetched 2026-11-14T01:18:33.201Z.

## Model: radar-5

No protocol is special-cased by name, and no coefficient is hardcoded.
Everything is computed at run time from the snapshot, in `lib/model.ts`.
The dashboard (`dashboard/app.js`) recomputes every row in the page
from the same fitted numbers and shows whether it matches `board.json`
— it does, for all 198 rows, including the farm verdict and net.

- **Eligible:** a protocol records no token (`mcap_usd`, `gecko_id` and
  `symbol` all null), its category is not Bridge / Canonical Bridge /
  Liquid Staking / Liquid Restaking / Restaked BTC / CEX, its name does
  not end in a version marker, carries no whole word `wrapped` /
  `staked` / `staking`, and does not start with an exchange name. That
  gives **198 rows** on the 2026-11-14 snapshot and covers all **40**
  watchlist slugs.
- **Fitted size curve:** ordinary least squares of `log(mcap_usd)` on
  `log(tvl_usd)` over the live-token protocols with a usable market cap
  (mcap > 0 and TVL > 0; the snapshot also carries mcap −1 and 0
  sentinels, which are excluded). **n = 128.**

  ```
  log(mcap) = 6.9646 + 0.5223 × log(TVL),  R² = 0.1939
  ```

  The slope is sublinear (0.52), so a large TVL buys proportionally
  less market cap than a small one. A flat multiple would use the
  live-token median mcap/TVL of **0.2138**. The dashboard's model panel
  shows the fitted formula and the number of live tokens used.
- **Category residual:** per-category median residual of the log-log
  fit, shrunk toward 0 with **30 pseudo-counts** (v3 used 20), clamped
  to [−1, 1] in log units. Examples: Lending −0.1824, Dexs +0.0363,
  RWA +0.0998, Risk Curators +0.0614, Prediction Market +0.2106.
  Categories with no live sample get 0.
- **Growth:** 7-day TVL change clamped to [−50, 100]%;
  multiplier = 1 + 0.60 × clamped / 100.
- **Launch value** = exp(intercept + slope × ln(TVL) + category
  log-adjustment) × growth multiplier.

### Out-of-sample test (computed in code, not claimed)

The fit is tested three ways in `lib/model.ts`, on the same 128
live-token protocols, and the numbers are shown in the dashboard's
model panel. Median absolute log error, in log units (a log error of
1.2 is roughly a factor of e^1.2 ≈ 3.3 — the fit is weak in absolute
terms, and the dashboard says so). Crucially, these tests refit the
**whole pipeline** — curve + category adjustment + growth — inside
each fold, so the category adjustment is not scored on data it was
fitted on. The bare-curve numbers are shown alongside for reference.

| test | full pipeline | flat 0.2138 multiple | factor | bare curve |
| --- | --- | --- | --- | --- |
| leave-one-out, median | **1.1888** (mean 1.5807) | 1.5816 | **1.3304×** | 1.2234 |
| 5-fold, deterministic by FNV-1a slug hash, median | **1.2448** (mean 1.6001) | — | — | 1.2518 |
| walk-forward, train 52 listed before 2024-06-01 / test 43, median | **1.0877** (fit on train: slope 0.5741, intercept 6.109) | 1.6152 | **1.4850×** | 1.1512 |

In-sample median absolute log error is 1.1066. The fitted pipeline
beats the flat multiple on every held-out test, by about 1.3–1.5×,
but the absolute error stays large: launch values here are
order-of-magnitude estimates, not prices.

Why 30 pseudo-counts and growth 0.60: v3's pipeline with 20
pseudo-counts and growth 0.40, tested the same honest way, scored
LOO 1.2085 / 5-fold 1.2473 / walk-forward 1.0877. Heavier shrinkage
helped a little more (pseudo 30: LOO 1.1888; pseudo 50: 1.1995, so
30 is the peak, not just "more is better"). Growth was swept
0.0–1.2: the median error keeps falling to 1.2, but the mean error
starts rising past 0.6, so 0.60 is the conservative pick — it helps
typical protocols without letting one hot week dominate a valuation.
v2's published LOO of 1.2234 was the bare curve only, so it is not
comparable to the full-pipeline numbers above. Spline, quadratic,
chain-count, log-age and median (LAD) curve variants were all tried
again for v4 and lost out of sample, so the curve stays plain
log-log.

### Launch odds — a fitted logistic, still falling with no-token age

Launch odds are a ridge logistic regression over all 758 protocols:
eight features, standardised, L2 λ = 10, 600 gradient-descent
iterations, learning rate 0.05 — `log(TVL)`, `log(1 + age_days)`,
`log(1 + chains)`, the clamped 7-day change / 100, the quadratic
terms `log(TVL)²` and `log(1 + age)²` and their product, and the
protocol's **category pre-token rate** (each category's share of
protocols that still record no token, shrunk toward the overall
share of 0.4512 with 50 pseudo-counts). Standardised weights: TVL
**−0.0576**, age **−0.1346**, chains **−0.2819**, growth **+0.2404**,
log(TVL)² −0.0505, log(1+age)² **−0.4255**, product −0.0766,
category rate **+0.8891**, intercept −0.2156. The category rate is
the strongest single feature, and the age terms stay negative, so
odds still fall with no-token age. Protocols with no listed date
use 2,000 days. Odds are clamped to [0.05, 0.95].

5-fold cross-validation (deterministic by FNV-1a slug hash) on the
758 protocols:

| odds method | log-loss | AUC |
| --- | --- | --- |
| ridge logistic, 8 features (radar-5) | **0.5780** | **0.7658** |
| ridge logistic, 2 features (radar-4) | 0.6468 | 0.7086 |
| v2 age-bucket method | 0.6472 | 0.6606 |

Both calibration and ranking improve: log-loss 0.647 → 0.578 and
AUC 0.709 → 0.766 against v3's two-feature logistic on the same
folds. The category rate alone (added to the two base features)
moves the CV to 0.580 / 0.763; the quadratic terms and chains add
the rest. A 50/50 blend of the new logistic with the bucket method
was tried and lost, so the pure logistic is kept.

Median logistic odds by no-token age bucket:

| no-token age | median logistic odds |
| --- | --- |
| <180d | **0.8008** |
| 180–365d | **0.6486** |
| 365–730d | **0.5419** |
| >730d | **0.3711** |

Protocols with no listed date use 2,000 days, so they sit in the
>730d bucket.

**Implied value = launch value × launch odds.**

### Top 10 (implied value)

| rank | protocol | implied value | launch odds | launch value |
| --- | --- | --- | --- | --- |
| 1 | Sentora Curator | $82,228,091 | 0.8448 | $97,334,388 |
| 2 | Steakhouse Financial | $71,484,265 | 0.7553 | $94,643,540 |
| 3 | Gauntlet | $57,688,874 | 0.7783 | $74,121,642 |
| 4 | Nonce Capital | $35,680,784 | 0.9497 | $37,570,584 |
| 5 | Veda | $28,221,935 | 0.4881 | $57,819,986 |
| 6 | RockawayX | $25,283,846 | 0.8636 | $29,277,265 |
| 7 | USDD | $23,800,102 | 0.4541 | $52,411,588 |
| 8 | Upshift | $19,865,632 | 0.5646 | $35,185,320 |
| 9 | Hyperithm | $19,775,987 | 0.7896 | $25,045,576 |
| 10 | Galaxy Curation | $19,443,124 | 0.9358 | $20,777,008 |

Bottom of the board is SyncSwap at $543,892 (SKIP). All 198 implied
values are distinct.

### Census — all 758 protocols accounted for

The dashboard's Census tab shows the whole ledger:

**198 ranked + 416 live-token + 144 excluded pre-token = 758.**

Excluded pre-token protocols, with a one-line reason each: category
CEX 42, Liquid Staking 38, Bridge 28, Canonical Bridge 15, versioned
name 11, wrapped/staked word in name 5, Liquid Restaking 3, Restaked
BTC 2. The Live token tab shows the top 24 by market cap (excluding
CEX / Bridge / Canonical Bridge); the census counts all 416 that
record a token.

### Farm economics — netted to the dollar

Each row gets a verdict from a stated, checkable arithmetic:

- Expected farm value = implied value × **10%** farmer share ÷
  farmers. Farmers are a stated proxy, not a measured headcount:
  **500 for rank 1, +10 per rank** (rank 1 → 510 farmers, rank 198 →
  2,480).
- Farm cost = capital + gas + time at **$25/hour**. Capital by TVL:
  $50 / $100 / $150 / $250. Gas is $4–$8 to set up plus $2 per week of
  the hold period. Time is charged at $25/hour inside the net, so a
  positive net already implies value/hour above $25.
- Hold period by age: 60 days if the protocol is under 180 days old,
  45 days under a year, 30 days otherwise.
- **Verdict:** SKIP if net ≤ $0; THIN if $0 < net ≤ $250; FARM
  otherwise. Counts: **FARM 87 / THIN 77 / SKIP 34.**

Each farm plan is 6 concrete steps, 20–600 characters each, every step
with a Cost and a Time, category-specific. Step 5 is the verdict check
with the row's net and $/hour, and the detail view adds a break-even
farmer count and a "what would change it" line — e.g. rank 1 Sentora
Curator: expected value $16,123.16, cost $201.25 (capital $150 + gas
$18 + 1.33h × $25), net **$15,921.91**, $12,122.68/hour, break-even at
40,858 farmers.

## Dashboard

`dashboard/` is 29,961 bytes total (index.html 6,049, app.css 3,704,
app.js 20,208), no network, no `http://`/`https://` in attributes or
imports. It is a sortable/filterable board with search, a category
filter, tabs (Pre-token board / Live token / Census · all 758), a
detail dialog per protocol, and hash deep-links (`#p=<slug>`,
`#category=<name>`, `#q=<text>`). Added over v1:

- a KPI strip: watchlist 40/40, 758 accounted for, fitted R², LOO
  error, and the FARM / THIN / SKIP counts;
- a model panel: the fitted curve formula, the out-of-sample table
  (full pipeline and bare curve), the launch-odds logistic details and
  CV comparison, the category adjustments, and the category
  pre-token rates the odds now use;
- in the detail view, the row is recomputed in the page (fit + odds +
  implied) and the page states whether it matches `board.json`, plus
  the farm verdict, net, $/hour, break-even farmers and the
  "what would change it" line.

Screenshots (1440×900 JPEG, taken with headless Chromium of this
dashboard, not reused from v2):

- `screenshots/1-board.jpg` — 129,397 bytes, the board;
- `screenshots/2-detail.jpg` — 206,796 bytes, rank 1 Sentora Curator
  detail with the FARM verdict;
- `screenshots/3-filtered.jpg` — 122,402 bytes, Category = Lending
  (16 rows);
- `screenshots/4-methodology.jpg` — 184,291 bytes, the model panel's
  launch-odds section: age-bucket medians, the 5-fold CV comparison
  and the category pre-token rates.

## What changed vs v3 (radar-4)

- **Launch odds: 2 features → 8.** The category pre-token rate is
  the big one: categories where most protocols are still pre-token
  (Risk Curators 63.6%, Onchain Capital Allocator 53.9%) lift a
  protocol's odds, while categories where almost every protocol
  already has a token (Lending 30.9%, Dexs 32.6%) pull them down.
  Cross-validated log-loss 0.647 → 0.578, AUC 0.709 → 0.766. The
  board's top 10 changes at the edges — Hyperithm and Galaxy
  Curation enter at ranks 9–10, Bittensor dTAO and Theo Network
  thUSD drop out — and the top implied value rises from $48.2M to
  $82.2M, because the new odds give the biggest curators much
  higher launch probabilities (Sentora Curator 0.48 → 0.84).
- **Category shrinkage 20 → 30 pseudo-counts; growth 0.40 → 0.60.**
  Full-pipeline LOO 1.2085 → 1.1888, 5-fold 1.2473 → 1.2448,
  walk-forward unchanged at 1.0877.
- **Farm verdicts move with the odds:** FARM 81 → 87, THIN 88 →
  77, SKIP 29 → 34.

## What changed vs v2 (radar-3)

- **Category shrinkage 5 → 20 pseudo-counts.** v2's adjustment hurt
  out of sample when refitted inside each fold (full-pipeline LOO
  1.3509, worse than the bare curve's 1.2234). With 20 pseudo-counts
  the full pipeline beats the bare curve on every test: LOO 1.2085
  vs 1.2234, walk-forward 1.0877 vs 1.1512.
- **Launch odds: age buckets → ridge logistic.** Same calibration
  (log-loss 0.6468 vs 0.6472), much better ranking (AUC 0.7086 vs
  0.6606), and a smooth monotone-in-age form instead of four flat
  buckets. Young protocols now get differentiated odds instead of one
  shared bucket value: Nonce Capital (45 days, 0.8064) and Bittensor
  dTAO (56 days, 0.7848) rise to ranks 4–5, while old protocols are
  penalised — Polymarket International (1,845 days) drops out of the
  top 10 and the top implied value falls from $69.7M to $48.2M.
- **Honest reporting:** the dashboard now shows full-pipeline
  out-of-sample numbers, with the bare-curve numbers alongside, so
  the category adjustment cannot be scored on data it was fitted on.

v2 itself replaced v1's flat per-category median mcap/TVL (global
median 0.25) and rising-with-age maturity with the fitted log-log
curve and falling-with-age odds; its top implied value was $69.7M
vs v1's $1.39B.

## Honest limits

- The size fit is weak (R² 0.1939, held-out median log error ~1.2,
  a factor of ~3.3). Implied values are order-of-magnitude estimates.
- "Records no token" means the snapshot has no `mcap_usd`,
  `gecko_id` or `symbol` for the protocol. That is what the snapshot
  says, not proof it has no token or that it will issue one.
- The farmer count is a stated proxy (500 + 10 × rank), not a
  measured headcount; the 10% farmer share is a stated assumption.
- The snapshot is sealed at 2026-11-14. Nothing here is live data.

## Layout

```
main.ts                 entry point, Node stdlib only
lib/model.ts            radar-5: fit, OOS tests, odds, census, farm economics
dashboard/              index.html, app.css, app.js (29,961 bytes, no network)
screenshots/             1-board.jpg, 2-detail.jpg, 3-filtered.jpg, 4-methodology.jpg (1440×900)
vendor/makefun-board.ts kit library, copied unchanged
out/                    generated output (board.json, data.js, dossier.json)
out2/                   second generated output, byte-identical to out/
```

License: MIT. See `LICENSE`.
