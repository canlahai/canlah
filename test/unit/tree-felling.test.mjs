import assert from 'node:assert/strict';
import { girthBand, classifyTree, summarize, aggregateTakeoff, normalizeStatus, normalizeType, parseTreeExtraction, expandExtraction } from '../../lib/tree-felling.js';

// ── expandExtraction: compact columnar rows → trees with derived flags ────
const ex = expandExtraction({
  treeColumns: ['no', 'girth', 'height', 'species', 'sheet', 'type', 'status'],
  treeRows: [
    ['E1', 3.5, 12, 'Rain Tree', '0004', 'tree', 'remove'],
    ['E1', 0.5, 4, 'Mango', '0004', 'tree', 'retain'],   // duplicate no
    ['E2', '-', null, '', '0005', 'tree', 'unknown'],     // missing data
    ['E3', 'Cluster', 5, 'Bamboo', '0005', 'shrub', 'remove'],
  ],
});
assert.equal(ex.trees.length, 4, 'compact rows expanded to objects');
assert.equal(ex.treeRows, undefined, 'treeRows removed after expansion');
assert.equal(ex.trees[0].girth, 3.5, 'columns mapped to fields');
assert.deepEqual(ex.trees[0].flags.sort(), ['duplicate', 'heritage_candidate', 'high_conservation', 'protected'], 'derived flags for big conservation duplicate');
assert.equal(ex.trees[2].girth, null, '"-" girth → null');
assert.ok(ex.trees[2].flags.includes('missing_data'), 'missing data flagged');
assert.equal(ex.trees[3].girth, -1, '"Cluster" girth → -1');
assert.equal(ex.trees[3].status, 'remove', 'status preserved from compact row');

// ── parseTreeExtraction: clean + truncated (salvage) ──────────────────────
const clean = parseTreeExtraction('```json\n{"totalRemove":200,"totalRetain":62,"sheets":[{"sheetNo":"0004","removeCount":87,"retainCount":60}],"trees":[{"no":"E1","girth":0.5,"status":"remove"}]}\n```');
assert.equal(clean.totalRemove, 200, 'clean parse: totalRemove');
assert.equal(clean.trees.length, 1, 'clean parse: trees');
assert.ok(!clean._truncated, 'clean parse: not flagged truncated');

// Output cut off mid-way through the trees array (totals/sheets came first).
const truncated = '{"projectName":"Pioneer Rd","sheets":[{"sheetNo":"0004","removeCount":87,"retainCount":60},{"sheetNo":"0005","removeCount":113,"retainCount":2}],"totalRemove":200,"totalRetain":62,"totals":{"remove":200,"retain":62,"transplant":0},"trees":[{"no":"E7309","girth":0.67,"height":6,"species":"Rain Tree","status":"retain"},{"no":"E7310","girth":0.5,"hei';
const salv = parseTreeExtraction(truncated);
assert.ok(salv._truncated, 'truncated: flagged');
assert.equal(salv.totalRemove, 200, 'truncated: totalRemove recovered');
assert.equal(salv.totalRetain, 62, 'truncated: totalRetain recovered');
assert.equal(salv.sheets.length, 2, 'truncated: sheets recovered');
assert.equal(salv.trees.length, 1, 'truncated: only the complete tree row recovered');
assert.ok(salv.dataIssues.some((d) => /truncated/i.test(d)), 'truncated: dataIssue added');

// Totally unrecoverable totals → summed from recovered sheet tallies.
const noTotals = '{"sheets":[{"sheetNo":"0004","removeCount":87,"retainCount":60},{"sheetNo":"0005","removeCount":113,"retainCount":2}],"trees":[{"no":"E1';
const summed = parseTreeExtraction(noTotals);
assert.equal(summed.totalRemove, 200, 'summed remove from sheet tallies (87+113)');
assert.equal(summed.totalRetain, 62, 'summed retain from sheet tallies (60+2)');

// ── girth band boundaries ─────────────────────────────────────────────
assert.equal(girthBand(0.3).key, 'S', '0.3m -> Small');
assert.equal(girthBand(0.5).key, 'M', '0.5m -> Medium (boundary goes up)');
assert.equal(girthBand(1.0).key, 'L', '1.0m -> Large');
assert.equal(girthBand(2.0).key, 'XL', '2.0m -> Very large');
assert.equal(girthBand(5.0).key, 'XL', 'huge -> Very large');
assert.equal(girthBand(null).key, 'unknown', 'null -> unknown');
assert.equal(girthBand(-1).key, 'cluster', '-1 -> cluster');

// ── protected / heritage flags ────────────────────────────────────────
assert.equal(classifyTree({ girth: 0.8 }).isProtected, false, '0.8m not protected');
assert.equal(classifyTree({ girth: 1.5 }).isProtected, true, '1.5m protected (>1.0)');
assert.equal(classifyTree({ girth: 1.0 }).isProtected, false, '1.0m not protected (boundary)');
assert.equal(classifyTree({ girth: 2.5 }).isHeritageCandidate, false, '2.5m not heritage');
assert.equal(classifyTree({ girth: 3.5 }).isHeritageCandidate, true, '3.5m heritage (>3.0)');
assert.equal(classifyTree({ girth: null }).isProtected, false, 'unknown girth not protected');

// ── status / type normalisation ───────────────────────────────────────
assert.equal(normalizeStatus('Removed'), 'remove', 'Removed -> remove');
assert.equal(normalizeStatus('TO BE REMOVED'), 'remove', 'phrase -> remove');
assert.equal(normalizeStatus('Retain'), 'retain', 'Retain -> retain');
assert.equal(normalizeStatus('to be retained'), 'retain', 'phrase -> retain');
assert.equal(normalizeStatus('Transplant'), 'transplant', 'Transplant -> transplant');
assert.equal(normalizeStatus(''), 'unknown', 'blank -> unknown');
assert.equal(normalizeStatus(undefined), 'unknown', 'missing -> unknown');
assert.equal(normalizeType('shrub'), 'shrub', 'shrub -> shrub');
assert.equal(normalizeType('Tree'), 'tree', 'Tree -> tree');
assert.equal(normalizeType(undefined), 'tree', 'default -> tree');

// ── summarise: remove/retain from STATUS, girth analysis on REMOVED only ──
const trees = [
  { girth: 0.3, status: 'remove' }, { girth: 0.4, status: 'remove' }, // S x2 removed
  { girth: 0.7, status: 'remove' },                                    // M removed
  { girth: 1.5, status: 'remove' },                                    // L removed (protected)
  { girth: 2.5, status: 'remove' },                                    // XL removed (protected)
  { girth: 3.5, status: 'remove' },                                    // XL removed (protected + heritage)
  { girth: null, status: 'remove' },                                   // unknown removed
  { girth: -1, status: 'remove' },                                     // cluster removed
];
const s = summarize(trees);
assert.equal(s.total, 8, 'total trees');
assert.equal(s.remove, 8, 'all 8 removed (by status)');
assert.equal(s.retain, 0, 'none retained');
assert.deepEqual(s.removed.byBand, { S: 2, M: 1, L: 1, XL: 2, cluster: 1, unknown: 1 }, 'removed band counts');
assert.equal(s.protected, 3, 'three protected (1.5, 2.5, 3.5)');
assert.equal(s.heritage, 1, 'one heritage candidate (3.5)');
// replacement (removed) = S*1 + M*2 + L*3 + XL*5 = 2 + 2 + 3 + 10 = 17
assert.equal(s.removed.replacement, 17, 'replacement-planting count (removed)');
assert.equal(s.replacement, 17, 'back-compat replacement reflects removed set');

// ── status drives remove/retain, NOT girth; tree/shrub split ──────────────
const mixed = [
  { girth: 0.3, status: 'retain', type: 'tree' },  // retained, small
  { girth: 0.4, status: 'remove', type: 'tree' },  // removed, S
  { girth: 0.6, status: 'remove', type: 'shrub' }, // removed shrub (not a felled TREE)
  { girth: 2.5, status: 'retain', type: 'tree' },  // PROTECTED but RETAINED (girth would mislead)
  { girth: 1.5, status: 'remove', type: 'tree' },  // removed, L (protected)
];
const m = summarize(mixed);
assert.equal(m.remove, 3, 'three removed by status');
assert.equal(m.retain, 2, 'two retained by status');
assert.equal(m.removeTrees, 2, 'two removed TREES');
assert.equal(m.removeShrubs, 1, 'one removed shrub');
assert.equal(m.retainTrees, 2, 'two retained trees');
assert.equal(m.removed.total, 2, 'removed-tree girth analysis excludes shrubs');
assert.deepEqual(m.removed.byBand, { S: 1, M: 0, L: 1, XL: 0, cluster: 0, unknown: 0 }, 'removed tree bands (0.4->S, 1.5->L)');
assert.equal(m.removed.replacement, 1 + 3, 'replacement only for removed trees (S*1 + L*3)');
assert.equal(m.protected, 2, 'overall protected counts retained 2.5m too');
assert.equal(m.removed.protected, 1, 'only the removed protected tree is in the felling set');

// ── take-off aggregation (REMOVED trees only; drops zero-qty rows) ────────
const rows = aggregateTakeoff(trees);
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
assert.equal(byId['TO-S'].qty, 2, 'small girth qty');
assert.equal(byId['TO-XL'].qty, 2, 'very large girth qty');
assert.equal(byId['TO-HER'].qty, 1, 'heritage qty');
assert.equal(byId['TO-REP'].qty, 17, 'replacement qty');
assert.ok(rows.every((r) => r.qty > 0), 'no zero-qty rows');
assert.ok(rows.every((r) => r.unit === 'nr'), 'all units nr');

// retained trees never reach the felling take-off
assert.equal(aggregateTakeoff([{ girth: 2.5, status: 'retain' }]).length, 0, 'retained tree => empty take-off');

// ── configurable thresholds (verify-against-NParks safety) ────────────
const strictCfg = {
  bands: [
    { key: 'S', label: 's', max: 0.5 }, { key: 'M', label: 'm', max: 1.0 },
    { key: 'L', label: 'l', max: 2.0 }, { key: 'XL', label: 'xl', max: Infinity },
  ],
  protectedGirth: 2.0,
  heritageGirth: 2.0,
  replacementRatio: { S: 1, M: 1, L: 1, XL: 1 },
};
const strict = summarize([{ girth: 2.5 }], strictCfg);
assert.equal(strict.heritage, 1, 'lower heritage threshold flags 2.5m');
assert.equal(classifyTree({ girth: 2.5 }, strictCfg).isProtected, true, 'custom protected threshold applies');

console.log('tree-felling.test.mjs — all assertions passed');
