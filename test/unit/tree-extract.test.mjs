import assert from 'node:assert/strict';
import { mergeSheetResults } from '../../lib/tree-extract.js';

const cols = ['no', 'girth', 'height', 'species', 'type', 'status'];

const results = [
  // 0001 — plan/cover page: no tally, no rows → must be skipped entirely.
  { sheetNo: '0001', tallies: [], treeRows: [] },

  // 0004 — printed tally that agrees with the coloured rows.
  { sheetNo: '0004', projectName: 'Pioneer Road', drawingRef: 'LRC216/RR/WSCL/0004',
    tallies: [{ removed: 2, retained: 1, text: 'TREES TO BE REMOVED : 2 NOS' }],
    treeColumns: cols,
    treeRows: [['E1', 0.4, 4, 'Mango', 'tree', 'remove'], ['E2', 3.5, 12, 'Rain Tree', 'tree', 'remove'], ['E3', 0.6, 5, 'Angsana', 'tree', 'retain']] },

  // 0005 — TWO printed tally blocks (multi-table sheet) → summed.
  { sheetNo: '0005', tallies: [{ removed: 10, retained: 0 }, { removed: 3, retained: 2 }], treeRows: [] },

  // 0006 — no printed tally → fall back to counting coloured rows.
  { sheetNo: '0006', tallies: [], treeColumns: cols,
    treeRows: [['E10', 0.5, 4, 'X', 'tree', 'remove'], ['E11', 0.5, 4, 'Y', 'tree', 'retain']] },

  // 0007 — printed tally disagrees with the rows (misread) → discrepancy flag.
  { sheetNo: '0007', tallies: [{ removed: 50, retained: 5 }], treeColumns: cols,
    treeRows: [['E20', 0.5, 4, 'X', 'tree', 'remove']] },
];

const doc = mergeSheetResults(results);

// Plan page skipped; only the four table sheets remain.
assert.deepEqual(doc.sheets.map((s) => s.sheetNo), ['0004', '0005', '0006', '0007'], 'cover page skipped, table sheets kept in order');

const by = Object.fromEntries(doc.sheets.map((s) => [s.sheetNo, s]));
assert.equal(by['0004'].removeCount, 2, '0004 printed remove');
assert.equal(by['0004'].source, 'printed tally', '0004 from printed tally');
assert.equal(by['0004'].discrepancy, null, '0004 tally matches rows → no discrepancy');

assert.equal(by['0005'].removeCount, 13, '0005 sums both tally blocks (10+3)');
assert.equal(by['0005'].retainCount, 2, '0005 retain (0+2)');

assert.equal(by['0006'].source, 'row count', '0006 falls back to counting rows');
assert.equal(by['0006'].removeCount, 1, '0006 counted remove');
assert.equal(by['0006'].retainCount, 1, '0006 counted retain');

assert.ok(by['0007'].discrepancy, '0007 printed tally vs rows mismatch → discrepancy set');
assert.equal(by['0007'].removeCount, 50, '0007 still reports the printed (authoritative) number');

// Totals are the sum of the per-sheet headline counts.
assert.equal(doc.totalRemove, 2 + 13 + 1 + 50, 'totalRemove summed across sheets');
assert.equal(doc.totalRetain, 1 + 2 + 1 + 5, 'totalRetain summed across sheets');

// Project metadata picked up from whichever sheet had it.
assert.equal(doc.projectName, 'Pioneer Road', 'projectName carried through');

// Rows concatenated (0004:3 + 0006:2 + 0007:1 = 6) with flags derived + sheet tagged.
assert.equal(doc.trees.length, 6, 'rows merged across sheets');
const e2 = doc.trees.find((t) => t.no === 'E2');
assert.ok(e2.flags.includes('heritage_candidate'), 'big girth → heritage flag derived');
assert.equal(e2.sheet, '0004', 'row tagged with its sheet');

// Discrepancies + missing-tally surfaced as data issues for the user.
assert.ok(doc.dataIssues.some((d) => d.includes('0007') && /differs/.test(d)), '0007 discrepancy reported');
assert.ok(doc.dataIssues.some((d) => d.includes('0006') && /no printed tally/.test(d)), '0006 fallback reported');

console.log('tree-extract.test.mjs — all assertions passed');
