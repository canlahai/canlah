// Programme-generator eval runner.
//
// Loads every fixture in eval/fixtures/*.json, generates a programme from each
// fixture's profile, scores it against the four acceptance metrics, and prints a
// report. Exit code is non-zero if any fixture with status "real" fails — so this
// can gate CI once real reference programmes exist. Synthetic fixtures are
// reported but never gate.
//
//   npm run eval            # all fixtures
//   npm run eval -- --json  # machine-readable scorecards
//   node eval/run.mjs <id>  # one fixture by id

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateProgramme } from '../lib/programme-generator.js';
import { scoreFixture } from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const idFilter = args.find((a) => !a.startsWith('--'));

function loadFixtures() {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')))
    .filter((fx) => !idFilter || fx.id === idFilter)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const mark = (ok) => (ok ? PASS : FAIL);

function printScorecard(card) {
  const r = card.results;
  const tag = card.status === 'real' ? 'real' : 'synthetic';
  console.log(`\n${mark(card.pass)}  ${card.id}  [${tag}]`);

  console.log(
    `   duration     ${mark(r.duration.pass)}  ` +
      `generated ${r.duration.generated}d vs expected ${r.duration.expected}d  ` +
      `(error ${r.duration.errorPct}%, tol ±${r.duration.tolerancePct}%)`
  );

  console.log(
    `   criticalPath ${mark(r.criticalPath.pass)}  ` +
      `overlap ${r.criticalPath.overlap} (min ${r.criticalPath.minOverlap}), ` +
      `recall ${r.criticalPath.recall}`
  );
  if (!r.criticalPath.pass) {
    if (r.criticalPath.missing.length)
      console.log(`        missing from generated CP: ${r.criticalPath.missing.join(', ')}`);
    if (r.criticalPath.extra.length)
      console.log(`        extra in generated CP:      ${r.criticalPath.extra.join(', ')}`);
  }

  console.log(
    `   gateways     ${mark(r.gateways.pass)}  ` +
      `present ${r.gateways.present.length}/${r.gateways.present.length + r.gateways.missing.length}`
  );
  for (const c of r.gateways.sequencing) if (!c.ok) console.log(`        seq FAIL: ${c.rule}`);
  if (r.gateways.missing.length) console.log(`        missing: ${r.gateways.missing.join(', ')}`);

  console.log(
    `   wbs          ${mark(r.wbs.pass)}  ` +
      `covered ${r.wbs.covered.length}/${r.wbs.covered.length + r.wbs.missing.length}`
  );
  if (r.wbs.missing.length) console.log(`        missing phases: ${r.wbs.missing.join(', ')}`);
}

const fixtures = loadFixtures();
if (fixtures.length === 0) {
  console.error(idFilter ? `No fixture with id "${idFilter}".` : 'No fixtures found in eval/fixtures/.');
  process.exit(1);
}

const cards = fixtures.map((fx) => scoreFixture(generateProgramme(fx.profile), fx));

if (asJson) {
  console.log(JSON.stringify(cards, null, 2));
} else {
  console.log('Programme-generator eval');
  console.log('========================');
  for (const card of cards) printScorecard(card);

  const real = cards.filter((c) => c.status === 'real');
  const synth = cards.filter((c) => c.status !== 'real');
  const realPass = real.filter((c) => c.pass).length;
  const synthPass = synth.filter((c) => c.pass).length;

  console.log('\n------------------------');
  console.log(`real:      ${realPass}/${real.length} passing  (gates CI)`);
  console.log(`synthetic: ${synthPass}/${synth.length} passing  (informational)`);
  if (real.length === 0) {
    console.log('\nNo real fixtures yet. Add one (see eval/fixtures/_SCHEMA.md) to make this gate meaningful.');
  }
}

const realFailed = cards.some((c) => c.status === 'real' && !c.pass);
process.exit(realFailed ? 1 : 0);
