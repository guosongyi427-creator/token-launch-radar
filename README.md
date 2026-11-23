# Token Launch Radar — radar-4

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/guosongyi427-creator/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/guosongyi427-creator/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Built for [make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01): Build the best token launch radar.

A token launch radar for make.fun's `token-radar-01` bounty. It reads a
sealed DefiLlama snapshot, ranks the protocols that record no token by an
implied launch value, and hands in a static dashboard with a detail view
and a farm plan for every protocol.

This is v3 (model **radar-4**). It replaces v2's bucket launch odds
with a fitted ridge-logistic odds model, and it tests the **whole**
value pipeline out of sample (not just the bare size curve). The
census of all 758 protocols and the costed farm plans are unchanged
in shape.

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
board.json   6eb45bfab75bd0d926e223de9762f66e2c925439a7af4cfbfa331b1ec1b348d6
dossier.json 5eb938011b7435f38aeec9d70df77d95313874467f58fc694abd04ac55ffaf1c
data.js      d563b11e53b14c953f62916a50f2b98e6e36227ed210b7c9251caa63b546d1ed
```

Snapshot: 758 protocols, 40 watchlist, as of 2026-11-14, floor
$50,000,000 TVL, source DefiLlama `https://api.llama.fi/protocols`,
fetched 2026-11-14T01:18:33.201Z.

## Model: radar-4

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
  fit, shrunk toward 0 with **20 pseudo-counts** (v2 used 5), clamped
  to [−1, 1] in log units. Examples: Lending −0.2345, Dexs +0.048,
  RWA +0.1342, Risk Curators +0.0906, Prediction Market +0.3109.
  Categories with no live sample get 0.
- **Growth:** 7-day TVL change clamped to [−50, 100]%;
  multiplier = 1 + 0.40 × clamped / 100.
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
| leave-one-out, median | **1.2085** (mean 1.5791) | 1.5816 | **1.3088×** | 1.2234 |
| 5-fold, deterministic by FNV-1a slug hash, median | **1.2473** (mean 1.6010) | — | — | 1.2518 |
| walk-forward, train 52 listed before 2024-06-01 / test 43, median | **1.0877** (fit on train: slope 0.5741, intercept 6.109) | 1.6152 | **1.4849×** | 1.1512 |

In-sample median absolute log error is 1.1202. The fitted pipeline
beats the flat multiple on every held-out test, by about 1.3–1.5×,
but the absolute error stays large: launch values here are
order-of-magnitude estimates, not prices.

Why 20 pseudo-counts: v2's pipeline with 5 pseudo-counts, tested the
same honest way, scored LOO 1.3509 / 5-fold 1.2908 / walk-forward
1.1636 — **worse than the bare curve**, so v2's category adjustment
was overfitting. Heavier shrinkage fixed it (pseudo 10: LOO 1.2628;
pseudo 20: 1.2085; pseudo 40: 1.2102). v2's published LOO of 1.2234
was the bare curve only, so it is not comparable to the full-pipeline
numbers above. Spline, quadratic, chain-count, log-age and median
(LAD) curve variants were all tried and lost out of sample, so the
curve stays plain log-log.

### Launch odds — a fitted logistic, still falling with no-token age

Launch odds are a ridge logistic regression over all 758 protocols:
features `log(TVL)` and `log(1 + age_days)`, standardised, L2 λ = 10,
600 gradient-descent iterations, learning rate 0.05. Standardised
weights: TVL **−0.0537**, age **−0.6402**, intercept −0.185. Age is by
far the dominant feature, and its weight is negative, so odds fall
with no-token age by construction. Odds are clamped to [0.05, 0.95].

5-fold cross-validation (deterministic by FNV-1a slug hash) on the
758 protocols:

| odds method | log-loss | AUC |
| --- | --- | --- |
| ridge logistic (radar-4) | **0.6468** | **0.7086** |
| v2 age-bucket method | 0.6472 | 0.6606 |

Calibration is about the same, but ranking is much better (AUC
0.709 vs 0.661). A 50/50 blend scored 0.6367 log-loss / 0.6904 AUC —
slightly better calibrated, worse ranked — so the pure logistic was
kept.

Median logistic odds by no-token age bucket:

| no-token age | median logistic odds |
| --- | --- |
| <180d | **0.7625** |
| 180–365d | **0.5791** |
| 365–730d | **0.4677** |
| >730d | **0.3481** |
| age unknown | 0.371 |

**Implied value = launch value × launch odds.**

### Top 10 (implied value)

| rank | protocol | implied value | launch odds | launch value |
| --- | --- | --- | --- | --- |
| 1 | Sentora Curator | $48,209,477 | 0.4833 | $99,750,625 |
| 2 | Steakhouse Financial | $42,685,939 | 0.4361 | $97,881,080 |
| 3 | Gauntlet | $33,228,277 | 0.4402 | $75,484,501 |
| 4 | Nonce Capital | $31,839,858 | 0.8064 | $39,483,951 |
| 5 | Bittensor dTAO | $25,561,262 | 0.7848 | $32,570,415 |
| 6 | Veda | $23,388,396 | 0.4157 | $56,262,680 |
| 7 | USDD | $22,107,086 | 0.4240 | $52,139,353 |
| 8 | RockawayX | $17,904,646 | 0.5909 | $30,300,637 |
| 9 | Theo Network thUSD | $16,739,865 | 0.7733 | $21,647,311 |
| 10 | R25 | $16,156,323 | 0.6184 | $26,126,008 |

Bottom of the board is Nucleus at $1,154,790 (SKIP). All 198 implied
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
  otherwise. Counts: **FARM 81 / THIN 88 / SKIP 29.**

Each farm plan is 6 concrete steps, 20–600 characters each, every step
with a Cost and a Time, category-specific. Step 5 is the verdict check
with the row's net and $/hour, and the detail view adds a break-even
farmer count and a "what would change it" line — e.g. rank 1 Sentora
Curator: expected value $9,452.84, cost $201.25 (capital $150 + gas
$18 + 1.33h × $25), net **$9,251.59**, $7,107.40/hour, break-even at
23,955 farmers.

## Dashboard

`dashboard/` is 27,816 bytes total (index.html 5,344, app.css 3,704,
app.js 18,768), no network, no `http://`/`https://` in attributes or
imports. It is a sortable/filterable board with search, a category
filter, tabs (Pre-token board / Live token / Census · all 758), a
detail dialog per protocol, and hash deep-links (`#p=<slug>`,
`#category=<name>`, `#q=<text>`). Added over v1:

- a KPI strip: watchlist 40/40, 758 accounted for, fitted R², LOO
  error, and the FARM / THIN / SKIP counts;
- a model panel: the fitted curve formula, the out-of-sample table
  (full pipeline and bare curve), the launch-odds logistic details and
  CV comparison, and the category adjustments;
- in the detail view, the row is recomputed in the page (fit + odds +
  implied) and the page states whether it matches `board.json`, plus
  the farm verdict, net, $/hour, break-even farmers and the
  "what would change it" line.

Screenshots (1440×900 JPEG, taken with headless Chromium of this
dashboard, not reused from v2):

- `screenshots/1-board.jpg` — 130,321 bytes, the board;
- `screenshots/2-detail.jpg` — 196,860 bytes, rank 1 Sentora Curator
  detail with the FARM verdict;
- `screenshots/3-filtered.jpg` — 125,201 bytes, Category = Lending
  (16 rows).

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
lib/model.ts            radar-4: fit, OOS tests, odds, census, farm economics
dashboard/              index.html, app.css, app.js (27,816 bytes, no network)
screenshots/             1-board.jpg, 2-detail.jpg, 3-filtered.jpg (1440×900)
vendor/makefun-board.ts kit library, copied unchanged
out/                    generated output (board.json, data.js, dossier.json)
out2/                   second generated output, byte-identical to out/
```

License: MIT. See `LICENSE`.
