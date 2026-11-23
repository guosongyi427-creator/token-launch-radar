// token-radar-01 entry, model radar-4 (Node 22, standard library only).
//
// Reads the sealed snapshot, fits the size curve and launch odds on that
// snapshot with lib/model.ts, writes board.json and data.js, copies
// dashboard/ and screenshots/ to the output directory, and writes
// dossier.json last with the vendored buildDossier library.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts \
//     --input ../token-radar-01-kit/input/snapshot.json
//
// The program runs twice in grading and both runs must write the same
// bytes: there is no clock, no randomness and no network here. The fit,
// the out-of-sample tests and the odds are all deterministic functions
// of the snapshot file, so a second run on the same bytes is identical.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
if (dash.length === 0 || !dash.includes('index.html')) {
  process.stderr.write('token radar: dashboard/ must hold index.html\n');
  process.exit(1);
}
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(
    `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
  );
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// Dossier last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const f = radar.fit;
const o = radar.odds;
const v = radar.verdict_counts;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live shown, ${radar.live_total} live in census, ${radar.excluded_size} excluded)\n` +
    `token radar: fit log(mcap) = ${f.intercept} + ${f.slope} * log(TVL), R2 ${f.r_squared}, n=${f.n}; LOO median abs log err ${f.loo_median_abs_log_err} vs flat ${f.flat_median_abs_log_err} (${f.loo_factor_vs_flat}x); walk-forward ${f.walk_forward_median_abs_log_err} vs flat ${f.walk_forward_flat_median_abs_log_err} (${f.walk_forward_factor}x)\n` +
    `token radar: odds logistic 5-fold CV log-loss ${o.logistic_cv_logloss} AUC ${o.logistic_cv_auc} vs buckets ${o.bucket_cv_logloss} / ${o.bucket_cv_auc}; age weight ${o.logistic_age_weight}, TVL weight ${o.logistic_tvl_weight}\n` +
    `token radar: verdicts FARM ${v.FARM} / THIN ${v.THIN} / SKIP ${v.SKIP}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dash.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
