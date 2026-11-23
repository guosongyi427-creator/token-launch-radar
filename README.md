# Token Launch Radar — radar-3

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/guosongyi427-creator/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/guosongyi427-creator/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Built for [make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01): Build the best token launch radar.

A token launch radar for make.fun's `token-radar-01` bounty. It reads a
sealed DefiLlama snapshot, ranks the protocols that record no token by an
implied launch value, and hands in a static dashboard with a detail view
and a farm plan for every protocol.

This is v2 (model **radar-3**). It replaces v1's flat category multiple
and rising-with-age maturity with a curve fitted on the snapshot's own
live-token protocols, launch odds that **fall** with no-token age, a
census of all 758 protocols, and farm plans netted to the dollar.

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
board.json   23ed982b82d648a84948280035ea47ebb12e2ad477d5dad4af618077bac6c0ef
dossier.json c478bf35deb426fb2852f41de10e14fe95fd4274362ac67cbe880deadd077285
data.js      e87cd71978966fab92ff52dd39c9f0f745093d5e82c36427d54761d70f8dddb6
```

Snapshot: 758 protocols, 40 watchlist, as of 2026-11-14, floor
$50,000,000 TVL, source DefiLlama `https://api.llama.fi/protocols`,
fetched 2026-11-14T01:18:33.201Z.

## Model: radar-3

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
  fit, shrunk toward 0 with 5 pseudo-counts, clamped to [−1, 1] in log
  units. Examples: Lending −0.410, Dexs +0.093, RWA +0.278, Risk
  Curators +0.317, Prediction Market +1.000 (clamped). Categories with
  no live sample get 0.
- **Growth:** 7-day TVL change clamped to [−50, 100]%;
  multiplier = 1 + 0.40 × clamped / 100.
- **Launch value** = exp(intercept + slope × ln(TVL) + category
  log-adjustment) × growth multiplier.

### Out-of-sample test (computed in code, not claimed)

The fit is tested three ways in `lib/model.ts`, on the same 128
live-token protocols, and the numbers are shown in the dashboard's
model panel. Median absolute log error, in log units (a log error of
1.2 is roughly a factor of e^1.2 ≈ 3.3 — the fit is weak in absolute
terms, and the dashboard says so):

| test | fitted curve | flat 0.2138 multiple | factor |
| --- | --- | --- | --- |
| leave-one-out, median | **1.2234** (mean 1.5959) | 1.5816 | **1.2928×** |
| 5-fold, deterministic by FNV-1a slug hash, median | **1.2518** (mean 1.5943) | — | — |
| walk-forward, train 52 listed before 2024-06-01 / test 43, median | **1.1512** (fit on train: slope 0.5741, intercept 6.109) | 1.6152 | **1.4031×** |

In-sample median absolute log error is 1.2134. The fitted curve beats
the flat multiple on every held-out test, by about 1.3–1.4×, but the
absolute error stays large: launch values here are order-of-magnitude
estimates, not prices.

### Launch odds — they fall with no-token age

For each age bucket, the share of protocols that still record no token,
smoothed toward the overall pre-token share (0.4512) with 20
pseudo-counts, then forced non-increasing with age (running minimum).
Age is days since first tracked; protocols with no `listed_at` use the
overall share 0.4512. Odds are then multiplied by a TVL factor and a
growth factor (each bucket's pre-token share / overall share, clamped
to [0.85, 1.15]) and clamped to [0.05, 0.95].

| no-token age | raw pre-token share (n) | smoothed | odds used |
| --- | --- | --- | --- |
| <180d | 0.7356 (87) | 0.6825 | **0.6825** |
| 180–365d | 0.6027 (73) | 0.5701 | **0.5701** |
| 365–730d | 0.6175 (183) | 0.6011 | **0.5701** |
| >730d | 0.3212 (302) | 0.3293 | **0.3293** |

The 365–730d bucket's smoothed share (0.6011) is pulled down to
0.5701 by the isotonic step, so the odds never rise with age. TVL
buckets: $5–50M 0.4784 (439), $50–200M 0.4294 (170), $200M–$1B
0.4186 (86), >$1B 0.3651 (63). Growth buckets: <−10% 0.4021 (286),
−10–0% 0.4338 (355), 0–10% 0.6235 (85), 10–50% 0.5455 (22), >50%
1.0000 (6 — too few to carry weight, so growth also stays in the
launch value and the odds factor is clamped).

**Implied value = launch value × launch odds.**

### Top 10 (implied value)

| rank | protocol | implied value | launch odds | launch value |
| --- | --- | --- | --- | --- |
| 1 | Sentora Curator | $69,729,379 | 0.5573 | $125,120,006 |
| 2 | Steakhouse Financial | $57,200,865 | 0.4659 | $122,774,983 |
| 3 | Gauntlet | $52,766,460 | 0.5573 | $94,682,326 |
| 4 | Nonce Capital | $30,151,323 | 0.6088 | $49,525,826 |
| 5 | Polymarket International | $23,301,265 | 0.2937 | $79,336,961 |
| 6 | OnRe | $23,113,967 | 0.6082 | $38,003,892 |
| 7 | USDD | $22,706,148 | 0.4659 | $48,736,099 |
| 8 | Bittensor dTAO | $20,739,475 | 0.6088 | $34,066,155 |
| 9 | Galaxy Curation | $19,622,642 | 0.7470 | $26,268,597 |
| 10 | RockawayX | $19,326,528 | 0.5085 | $38,006,938 |

Bottom of the board is Vesu at $893,004 (SKIP). All 198 implied values
are distinct.

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
  otherwise. Counts: **FARM 87 / THIN 83 / SKIP 28.**

Each farm plan is 6 concrete steps, 20–600 characters each, every step
with a Cost and a Time, category-specific. Step 5 is the verdict check
with the row's net and $/hour, and the detail view adds a break-even
farmer count and a "what would change it" line — e.g. rank 1 Sentora
Curator: expected value $13,672.43, cost $201.25 (capital $150 + gas
$18 + 1.33h × $25), net **$13,471.18**, $10,280.02/hour, break-even at
34,648 farmers.

## Dashboard

`dashboard/` is 26,653 bytes total (index.html 5,444, app.css 3,704,
app.js 17,505), no network, no `http://`/`https://` in attributes or
imports. It is a sortable/filterable board with search, a category
filter, tabs (Pre-token board / Live token / Census · all 758), a
detail dialog per protocol, and hash deep-links (`#p=<slug>`,
`#category=<name>`, `#q=<text>`). Added over v1:

- a KPI strip: watchlist 40/40, 758 accounted for, fitted R², LOO
  error, and the FARM / THIN / SKIP counts;
- a model panel: the fitted curve formula, the out-of-sample table,
  the launch-odds-by-age table, and the category adjustments;
- in the detail view, the row is recomputed in the page (fit + odds +
  implied) and the page states whether it matches `board.json`, plus
  the farm verdict, net, $/hour, break-even farmers and the
  "what would change it" line.

Screenshots (1440×900 JPEG, taken with headless Chromium over CDP of
this dashboard, not reused from v1):

- `screenshots/1-board.jpg` — 201,350 bytes, the board;
- `screenshots/2-detail.jpg` — 315,581 bytes, rank 1 Sentora Curator
  detail with the FARM verdict;
- `screenshots/3-filtered.jpg` — 192,745 bytes, Category = Lending.

## What changed vs v1 (radar-2)

v1 used a flat per-category median mcap/TVL (global median 0.25) and a
maturity factor that **rose** with no-token age, so old, large
protocols dominated: its top 3 were Steakhouse Financial $1.39B,
Sentora Curator $1.36B, Gauntlet $822M. v2's fitted log-log curve is
sublinear (slope 0.52), so large-TVL protocols get a much lower
multiple than v1's flat 0.25 and small protocols relatively more; and
its launch odds **fall** with no-token age, so younger protocols are
boosted and old ones penalised — Veda (632 days with no token) falls
from v1 rank 5 to v2 rank 11, Polymarket (1,845 days, odds 0.294)
drops to rank 5, Sentora (407 days) overtakes Steakhouse (543 days) on
odds despite similar TVL, and Galaxy Curation (177 days, odds 0.747)
enters the top 10. Implied values are roughly 20× smaller than v1
($69.7M top vs $1.39B) because the fitted curve and the odds factor
both shrink the launch value.

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
lib/model.ts            radar-3: fit, OOS tests, odds, census, farm economics
dashboard/              index.html, app.css, app.js (26,653 bytes, no network)
screenshots/             1-board.jpg, 2-detail.jpg, 3-filtered.jpg (1440×900)
vendor/makefun-board.ts kit library, copied unchanged
out/                    generated output (board.json, data.js, dossier.json)
out2/                   second generated output, byte-identical to out/
```

License: MIT. See `LICENSE`.
