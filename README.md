# Token Launch Radar — radar-6

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/guosongyi427-creator/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/guosongyi427-creator/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Built for [make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01): Build the best token launch radar.

A token launch radar for make.fun's `token-radar-01` bounty. It reads a
sealed DefiLlama snapshot, ranks the protocols that record no token by an
implied launch value, and hands in a static dashboard with a detail view
and a farm plan for every protocol.

This is v5 (model **radar-6**). It keeps v4's fitted size curve and
improves both halves: heavier category shrinkage (40 pseudo-counts)
and a stronger growth weight (0.75) for the value, and a richer odds
model — eleven features instead of eight, adding a slower age scale,
the protocol's size relative to its own category, and a size ×
category-rate interaction — which lifts the odds' cross-validated
log-loss from 0.578 to 0.560 and AUC from 0.766 to 0.780. The census
of all 758 protocols and the costed farm plans are unchanged in
shape.

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
board.json   0797241ec420ba3d415441c8ccfe42fbd545939334cc8a9456f10f49de901394
dossier.json d5bf88d1440874f987ffd9dd47d3e2a589742745be55f26ff95e836b53e4231d
data.js      c1f4a0197a9cc23421ffe4a5b40732bcc8c718d21114b70f09525eb93583b865
```

Snapshot: 758 protocols, 40 watchlist, as of 2026-11-14, floor
$50,000,000 TVL, source DefiLlama `https://api.llama.fi/protocols`,
fetched 2026-11-14T01:18:33.201Z.

## Model: radar-6

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
  fit, shrunk toward 0 with **40 pseudo-counts** (v4 used 30), clamped
  to [−1, 1] in log units. Examples: Lending −0.1492, Dexs +0.0292,
  RWA +0.0794, Risk Curators +0.0464, Prediction Market +0.1593.
  Categories with no live sample get 0.
- **Growth:** 7-day TVL change clamped to [−50, 100]%;
  multiplier = 1 + 0.75 × clamped / 100.
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
| leave-one-out, median | **1.1731** (mean 1.5840) | 1.5816 | **1.3483×** | 1.2234 |
| 5-fold, deterministic by FNV-1a slug hash, median | **1.2121** (mean 1.6001) | — | — | 1.2518 |
| walk-forward, train 52 listed before 2024-06-01 / test 43, median | **1.0877** (fit on train: slope 0.5741, intercept 6.109) | 1.6152 | **1.4851×** | 1.1512 |

In-sample median absolute log error is 1.1117. The fitted pipeline
beats the flat multiple on every held-out test, by about 1.3–1.5×,
but the absolute error stays large: launch values here are
order-of-magnitude estimates, not prices.

Why 40 pseudo-counts and growth 0.75: v4's pipeline with 30
pseudo-counts and growth 0.60, tested the same honest way, scored
LOO 1.1888 / 5-fold 1.2448 / walk-forward 1.0877. Heavier shrinkage
helped a little more (pseudo 40: LOO 1.1731; pseudo 45–60: the LOO
median plateaus at ~1.172 while the LOO mean keeps rising, so 40
is the plateau's start, not just "more is better"). Growth was swept
0.0–1.2: the median error keeps falling to 1.2, but the mean error
starts rising past 0.75, so 0.75 is the conservative pick — it helps
typical protocols without letting one hot week dominate a valuation.
v2's published LOO of 1.2234 was the bare curve only, so it is not
comparable to the full-pipeline numbers above. Spline, quadratic,
chain-count, log-age and median (LAD) curve variants were all tried
again for v5 and lost out of sample, so the curve stays plain
log-log.

### Launch odds — a fitted logistic, still falling with no-token age

Launch odds are a ridge logistic regression over all 758 protocols:
eleven features, standardised, L2 λ = 5, 1,500 gradient-descent
iterations, learning rate 0.1 — `log(TVL)`, `log(1 + age_days)`,
`log(1 + chains)`, the clamped 7-day change / 100, the quadratic
terms `log(TVL)²` and `log(1 + age)²` and their product, the
protocol's **category pre-token rate** (each category's share of
protocols that still record no token, shrunk toward the overall
share of 0.4512 with 50 pseudo-counts), plus three new features:
`log(1 + age / 1095 days)`, a slower age scale; `log(TVL)` minus
the category's median log TVL, the protocol's size relative to its
own category; and `log(TVL)` × the category pre-token rate.
Standardised weights: TVL **−0.0639**, age **+0.1713**, chains
**−0.3263**, growth **+0.2707**, log(TVL)² −0.0255, log(1+age)²
**−0.2843**, product +0.3216, category rate **+0.4158**, slow-age
**−0.8392**, relative size **−0.5013**, size × category rate
**+0.5678**, intercept −0.2673. The age effect is now split across
two age features, so the plain log(1+age) weight flips positive —
but the slow-age weight is the largest in magnitude and dominates,
and the median odds still fall with no-token age (see the table
below). Protocols with no listed date use 2,000 days. Odds are
clamped to [0.05, 0.95].

5-fold cross-validation (deterministic by FNV-1a slug hash) on the
758 protocols:

| odds method | log-loss | AUC |
| --- | --- | --- |
| ridge logistic, 11 features (radar-6) | **0.5600** | **0.7801** |
| ridge logistic, 8 features (radar-5) | 0.5780 | 0.7658 |
| ridge logistic, 2 features (radar-4) | 0.6468 | 0.7086 |
| v2 age-bucket method | 0.6472 | 0.6606 |

Both calibration and ranking improve: log-loss 0.578 → 0.560 and
AUC 0.766 → 0.780 against v4's eight-feature logistic on the same
folds. Each new feature was added one at a time and kept only if it
improved the 5-fold CV: the slow-age scale alone moves the CV to
0.567 / 0.774, the category-relative size to 0.573 / 0.769, and the
size × category-rate interaction to 0.576 / 0.768; together they
reach 0.561, and the longer fit (1,500 iterations at lr 0.1, λ = 5)
reaches 0.560 / 0.780. A 50/50 blend of the new logistic with the
bucket method was tried and lost, so the pure logistic is kept.

Median logistic odds by no-token age bucket:

| no-token age | median logistic odds |
| --- | --- |
| <180d | **0.7402** |
| 180–365d | **0.7011** |
| 365–730d | **0.6055** |
| >730d | **0.3438** |

Protocols with no listed date use 2,000 days, so they sit in the
>730d bucket.

**Implied value = launch value × launch odds.**

### Top 10 (implied value)

| rank | protocol | implied value | launch odds | launch value |
| --- | --- | --- | --- | --- |
| 1 | Sentora Curator | $83,558,290 | 0.8684 | $96,220,969 |
| 2 | Steakhouse Financial | $72,424,673 | 0.7794 | $92,923,625 |
| 3 | Gauntlet | $58,981,251 | 0.8012 | $73,616,140 |
| 4 | Nonce Capital | $32,880,820 | 0.9024 | $36,437,079 |
| 5 | Veda | $29,875,982 | 0.5115 | $58,408,566 |
| 6 | RockawayX | $24,940,108 | 0.8681 | $28,729,534 |
| 7 | USDD | $23,200,916 | 0.4420 | $52,490,759 |
| 8 | Upshift | $21,650,460 | 0.5941 | $36,442,450 |
| 9 | OnRe | $20,497,616 | 0.6576 | $31,170,341 |
| 10 | Hyperithm | $19,796,283 | 0.8078 | $24,506,417 |

Bottom of the board is Katana DEX at $373,802 (SKIP). All 198 implied
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
  otherwise. Counts: **FARM 88 / THIN 72 / SKIP 38.**

Each farm plan is 6 concrete steps, 20–600 characters each, every step
with a Cost and a Time, category-specific. Step 5 is the verdict check
with the row's net and $/hour, and the detail view adds a break-even
farmer count and a "what would change it" line — e.g. rank 1 Sentora
Curator: expected value $16,383.98, cost $201.25 (capital $150 + gas
$18 + 1.33h × $25), net **$16,182.73**, $12,318.78/hour, break-even at
41,519 farmers.

## Dashboard

`dashboard/` is 31,193 bytes total (index.html 6,195, app.css 3,704,
app.js 21,294), no network, no `http://`/`https://` in attributes or
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

- `screenshots/1-board.jpg` — 129,414 bytes, the board;
- `screenshots/2-detail.jpg` — 210,834 bytes, rank 1 Sentora Curator
  detail with the FARM verdict;
- `screenshots/3-filtered.jpg` — 122,434 bytes, Category = Lending
  (16 rows);
- `screenshots/4-methodology.jpg` — 190,416 bytes, the model panel's
  launch-odds section: age-bucket medians, the 5-fold CV comparison
  and the category pre-token rates.

## What changed vs v4 (radar-5)

- **Launch odds: 8 features → 11.** Three new features, each kept
  only after it improved the 5-fold CV on its own: a slower age
  scale `log(1 + age / 1095 days)` (the biggest single gain, CV
  0.578 → 0.567), the protocol's size relative to its own category
  (CV 0.578 → 0.573), and `log(TVL)` × the category pre-token rate
  (CV 0.578 → 0.576). Together with the longer fit (1,500 iterations
  at lr 0.1, λ = 5 — v4's 600 iterations had not converged),
  cross-validated log-loss 0.578 → 0.560, AUC 0.766 → 0.780. The
  board's top 10 changes at the edges — OnRe enters at rank 9,
  Galaxy Curation drops out — and the top implied value rises from
  $82.2M to $83.6M. One honest side effect: the age effect is now
  split across two age features, so the plain log(1+age) weight
  flips from −0.13 to +0.17; the slow-age weight (−0.84) dominates
  and the median odds still fall with age (0.74 → 0.70 → 0.61 →
  0.34 across the four age buckets).
- **Category shrinkage 30 → 40 pseudo-counts; growth 0.60 → 0.75.**
  Full-pipeline LOO 1.1888 → 1.1731, 5-fold 1.2448 → 1.2121,
  walk-forward unchanged at 1.0877.
- **Farm verdicts move with the odds:** FARM 87 → 88, THIN 77 →
  72, SKIP 34 → 38.

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
lib/model.ts            radar-6: fit, OOS tests, odds, census, farm economics
dashboard/              index.html, app.css, app.js (31,193 bytes, no network)
screenshots/             1-board.jpg, 2-detail.jpg, 3-filtered.jpg, 4-methodology.jpg (1440×900)
vendor/makefun-board.ts kit library, copied unchanged
out/                    generated output (board.json, data.js, dossier.json)
out2/                   second generated output, byte-identical to out/
```

License: MIT. See `LICENSE`.
