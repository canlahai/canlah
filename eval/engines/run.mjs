// Engine eval runner — regulatory-threshold acceptance for the deterministic
// engines (HR DRC, tender tabulation, tree-felling girth bands).
//
// Loads eval/engines/fixtures/*.json, runs the named engine on each fixture's
// input, and checks the `expect` keys. Fixtures are plain JSON so a QS can read
// them, cite the rule basis, and add real authority worked-examples. Exit code
// is non-zero only if a `status:"real"` fixture fails (gates CI once real cases
// exist); synthetic fixtures are reported but never gate.
//
//   npm run eval:engines
//   npm run eval:engines -- --json
//   node eval/engines/run.mjs <id>

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeDRC } from '../../lib/hr-compliance.js';
import { buildTender } from '../../lib/tender.js';
import { summarize as summarizeTrees } from '../../lib/tree-felling.js';
import { scoreExpect } from './score.mjs';

// engine name -> (input) => output. Input shape is documented per engine in
// fixtures/_SCHEMA.md.
const ENGINES = {
  computeDRC: (input) => computeDRC(input),
  buildTender: (input) => buildTender(input),
  summarizeTrees: (input) => summarizeTrees(input.trees || []),
};

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const idFilter = args.find((a) => !a.startsWith('--'));

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const mark = (ok) => (ok ? PASS : FAIL);

const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')))
  .filter((fx) => !idFilter || fx.id === idFilter)
  .sort((a, b) => (a.id < b.id ? -1 : 1));

if (fixtures.length === 0) {
  console.error(idFilter ? `No fixture with id "${idFilter}".` : 'No fixtures in eval/engines/fixtures/.');
  process.exit(1);
}

const cards = fixtures.map((fx) => {
  const engine = ENGINES[fx.engine];
  if (!engine) return { id: fx.id, status: fx.status || 'real', pass: false, error: `unknown engine "${fx.engine}"`, mismatches: [] };
  let out;
  try {
    out = engine(fx.input || {});
  } catch (err) {
    return { id: fx.id, status: fx.status || 'real', pass: false, error: err.message, mismatches: [] };
  }
  const { pass, mismatches } = scoreExpect(out, fx.expect);
  return { id: fx.id, engine: fx.engine, status: fx.status || 'real', basis: fx.basis, pass, mismatches };
});

if (asJson) {
  console.log(JSON.stringify(cards, null, 2));
} else {
  console.log('Engine eval (regulatory thresholds)');
  console.log('===================================');
  for (const c of cards) {
    console.log(`\n${mark(c.pass)}  ${c.id}  [${c.status}]  (${c.engine || '?'})`);
    if (c.basis) console.log(`   basis: ${c.basis}`);
    if (c.error) console.log(`   ERROR: ${c.error}`);
    for (const m of c.mismatches) {
      console.log(`   ✗ ${m.key}: expected ${JSON.stringify(m.want)}, got ${JSON.stringify(m.got)}`);
    }
  }
  const real = cards.filter((c) => c.status === 'real');
  const synth = cards.filter((c) => c.status !== 'real');
  console.log('\n-----------------------------------');
  console.log(`real:      ${real.filter((c) => c.pass).length}/${real.length} passing  (gates CI)`);
  console.log(`synthetic: ${synth.filter((c) => c.pass).length}/${synth.length} passing  (informational)`);
  if (real.length === 0) console.log('\nNo real fixtures yet — add MOM/NParks worked examples (status:"real") to gate.');
}

process.exit(cards.some((c) => c.status === 'real' && !c.pass) ? 1 : 0);
