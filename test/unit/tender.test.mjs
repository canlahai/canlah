import assert from 'node:assert/strict';
import { parseBqCsv, parseNumber } from '../../lib/bq-parse.js';
import { suggestMatches, suggestionsToMappings, buildTender, tenderToCsv } from '../../lib/tender.js';

// ── BQ CSV parsing ────────────────────────────────────────────────────
assert.equal(parseNumber('$1,200.50'), 1200.5, 'strips $ and commas');
assert.equal(parseNumber(''), null, 'empty -> null');
assert.equal(parseNumber('N/A'), null, 'non-numeric -> null');

const csv = [
  'Item Code,Item Description,UOM,Unit Rate',
  'TF-01,"Fell and remove tree, small girth",nr,$80.00',
  'TF-02,Fell and remove tree medium girth,nr,"1,120.00"',
  'TF-03,Fell and remove tree large girth,nr,200',
  ',Section heading with no rate,,',
].join('\n');
const { lines, warnings } = parseBqCsv(csv);
assert.equal(lines.length, 4, 'four data lines parsed');
assert.equal(lines[0].ref, 'TF-01', 'ref column mapped');
assert.equal(lines[0].description, 'Fell and remove tree, small girth', 'quoted comma preserved');
assert.equal(lines[0].rate, 80, 'rate $80.00 -> 80');
assert.equal(lines[1].rate, 1120, 'quoted thousands rate parsed');
assert.equal(lines[3].rate, null, 'section heading row has null rate');
assert.equal(warnings.length, 0, 'clean parse, no warnings');

// Missing description column is a hard error
const bad = parseBqCsv('foo,bar\n1,2');
assert.ok(bad.warnings[0].includes('description'), 'errors when no description column');

// ── Match suggestion ──────────────────────────────────────────────────
const takeoff = [
  { id: 't1', description: 'Tree felling small girth', unit: 'nr', qty: 146 },
  { id: 't2', description: 'Tree felling medium girth', unit: 'nr', qty: 113 },
  { id: 't3', description: 'Tree felling large girth', unit: 'nr', qty: 52 },
];
const sugg = suggestMatches(takeoff, lines);
const sByT = Object.fromEntries(sugg.map((s) => [s.takeoffId, s]));
assert.equal(sByT.t1.suggestedRef, 'TF-01', 't1 -> small girth line');
assert.equal(sByT.t2.suggestedRef, 'TF-02', 't2 -> medium girth line');
assert.equal(sByT.t3.suggestedRef, 'TF-03', 't3 -> large girth line');
assert.ok(sByT.t1.confidence !== 'low', 't1 suggestion is confident');

// suggestionsToMappings just lifts the confident links
const mappings = suggestionsToMappings(sugg);
assert.deepEqual(mappings, { t1: 'TF-01', t2: 'TF-02', t3: 'TF-03' }, 'mappings built from suggestions');

// ── Tender tabulation ─────────────────────────────────────────────────
const tender = buildTender({ takeoffRows: takeoff, bqLines: lines, mappings, markupPct: 10 });
const rowByRef = Object.fromEntries(tender.rows.map((r) => [r.ref, r]));
assert.equal(rowByRef['TF-01'].qty, 146, 'TF-01 qty from take-off');
assert.equal(rowByRef['TF-01'].amount, 146 * 80, 'TF-01 amount = qty x rate');
assert.equal(rowByRef['TF-02'].amount, 113 * 1120, 'TF-02 amount');
assert.equal(rowByRef['TF-03'].amount, 52 * 200, 'TF-03 amount');
// section-heading line (auto ref L1) has no rate and no qty -> unmatched, amount null
const heading = tender.rows.find((r) => r.rate == null);
assert.ok(heading && heading.unmatched, 'un-priced heading line is unmatched');

const expectedSubtotal = 146 * 80 + 113 * 1120 + 52 * 200; // 11680 + 126560 + 10400 = 148640
assert.equal(tender.subtotal, expectedSubtotal, 'subtotal sums priced lines');
assert.equal(tender.markupAmount, expectedSubtotal * 0.10, '10% markup');
assert.equal(tender.total, expectedSubtotal * 1.10, 'total = subtotal + markup');
assert.equal(tender.unmatchedTakeoff.length, 0, 'all take-off rows mapped');

// ── Coverage + unit guard ─────────────────────────────────────────────
const t4 = { id: 't4', description: 'Stump grinding', unit: 'nr', qty: 30 };
const t5 = { id: 't5', description: 'Root barrier', unit: 'm', qty: 40 };
const tender2 = buildTender({
  takeoffRows: [...takeoff, t4, t5],
  bqLines: [...lines, { ref: 'TF-05', description: 'Root barrier install', unit: 'nr', rate: 25 }],
  mappings: { ...mappings, t5: 'TF-05' }, // t4 deliberately unmapped; t5 unit (m) != bq (nr)
});
assert.ok(tender2.unmatchedTakeoff.some((r) => r.id === 't4'), 't4 flagged as unmatched');
assert.ok(tender2.warnings.some((w) => /Unit mismatch on TF-05/.test(w)), 'unit mismatch flagged');

// ── CSV export ────────────────────────────────────────────────────────
const out = tenderToCsv(tender, 'Test');
assert.ok(out.startsWith('Ref,Description,Unit,Qty,Rate,Amount'), 'csv header');
assert.ok(out.includes('Total,' + tender.total), 'csv includes total');
assert.ok(out.includes('"Fell and remove tree, small girth"'), 'csv escapes commas in description');

console.log('tender.test.mjs — all assertions passed');
