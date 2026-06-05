import assert from 'node:assert/strict';
import { parseCsv, parseNumber, parseBqCsv } from '../../lib/bq-parse.js';

// --- parseCsv ---------------------------------------------------------------
assert.deepEqual(parseCsv('a,b,c'), [['a', 'b', 'c']], 'simple row');
assert.deepEqual(parseCsv('a,b\nc,d'), [['a', 'b'], ['c', 'd']], 'two rows on \\n');
assert.deepEqual(parseCsv('a,b\r\nc,d'), [['a', 'b'], ['c', 'd']], '\\r\\n handled');
assert.deepEqual(parseCsv('"a,b",c'), [['a,b', 'c']], 'comma inside quotes');
assert.deepEqual(parseCsv('"line1\nline2",x'), [['line1\nline2', 'x']], 'newline inside quotes');
assert.deepEqual(parseCsv('"she said ""hi""",x'), [['she said "hi"', 'x']], 'escaped quotes');
assert.deepEqual(parseCsv('a,b\n'), [['a', 'b']], 'trailing newline -> no empty row');
assert.deepEqual(parseCsv('a,b,'), [['a', 'b', '']], 'trailing empty field kept');

// --- parseNumber ------------------------------------------------------------
assert.equal(parseNumber('1234'), 1234, 'plain integer');
assert.equal(parseNumber('1,234.56'), 1234.56, 'thousands comma stripped');
assert.equal(parseNumber('$1,200.00'), 1200, 'currency symbol stripped');
assert.equal(parseNumber('  12.5 '), 12.5, 'whitespace stripped');
assert.equal(parseNumber('-50'), -50, 'negative preserved');
assert.equal(parseNumber('SGD 99'), 99, 'currency code stripped');
assert.equal(parseNumber(''), null, 'empty -> null');
assert.equal(parseNumber('   '), null, 'whitespace only -> null');
assert.equal(parseNumber('-'), null, 'lone dash -> null');
assert.equal(parseNumber('.'), null, 'lone dot -> null');
assert.equal(parseNumber('N/A'), null, 'non-numeric -> null');
assert.equal(parseNumber(null), null, 'null -> null');
assert.equal(parseNumber(0), 0, 'numeric zero handled');

// --- parseBqCsv: header synonyms + happy path -------------------------------
const csv = [
  'Item No.,Particulars,UOM,Unit Rate,Quantity',
  'A1,Excavate topsoil,m3,12.50,100',
  'A2,"Cart away, off site",m3,"1,234.00",50',
].join('\n');
const out = parseBqCsv(csv);
assert.equal(out.lines.length, 2, 'two data rows parsed');
assert.deepEqual(out.lines[0], { ref: 'A1', description: 'Excavate topsoil', unit: 'm3', rate: 12.5, qty: 100 }, 'first line mapped via synonyms');
assert.equal(out.lines[1].description, 'Cart away, off site', 'quoted comma description preserved');
assert.equal(out.lines[1].rate, 1234, 'quoted thousands rate parsed');
assert.equal(out.warnings.length, 0, 'clean BQ -> no warnings');

// --- missing description column ---------------------------------------------
const noDesc = parseBqCsv('ref,unit,rate\nA1,m3,5');
assert.equal(noDesc.lines.length, 0, 'no description column -> no lines');
assert.ok(noDesc.warnings.some((w) => /description/.test(w)), 'warns about missing description');

// --- missing rate column ----------------------------------------------------
const noRate = parseBqCsv('description,unit\nExcavate,m3');
assert.equal(noRate.lines[0].rate, null, 'no rate column -> rate null');
assert.ok(noRate.warnings.some((w) => /rate/.test(w)), 'warns about missing rate');

// --- auto-ref + blank-description skipping ----------------------------------
const autoRef = parseBqCsv('description,rate\nFirst,1\n,99\nSecond,2');
assert.equal(autoRef.lines.length, 2, 'blank-description row skipped');
assert.deepEqual(autoRef.lines.map((l) => l.ref), ['L1', 'L2'], 'auto refs assigned when no ref column');

// --- duplicate ref disambiguation (the hardened path) -----------------------
const dup = parseBqCsv('ref,description,rate\nA,one,1\nA,two,2\nA,three,3');
assert.deepEqual(dup.lines.map((l) => l.ref), ['A', 'A-2', 'A-3'], 'plain duplicates disambiguated');

// The regression case: a generated ref must not collide with a real one.
const collide = parseBqCsv('ref,description,rate\nA,one,1\nA,two,2\nA-2,three,3');
const refs = collide.lines.map((l) => l.ref);
assert.equal(new Set(refs).size, refs.length, 'all refs unique even when a real "A-2" exists');
assert.deepEqual(refs, ['A', 'A-2', 'A-2-2'], 'real A-2 pushed off the generated A-2');

// --- empty input ------------------------------------------------------------
const empty = parseBqCsv('');
assert.equal(empty.lines.length, 0, 'empty CSV -> no lines');
assert.ok(empty.warnings.some((w) => /Empty/i.test(w)), 'empty CSV warns');

console.log('bq-parse.test.mjs — all assertions passed');
