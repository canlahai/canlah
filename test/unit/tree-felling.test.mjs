import assert from 'node:assert/strict';
import { girthBand, classifyTree, summarize, aggregateTakeoff } from '../../lib/tree-felling.js';

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

// ── summarise a register ──────────────────────────────────────────────
const trees = [
  { girth: 0.3 }, { girth: 0.4 },   // S x2
  { girth: 0.7 },                   // M
  { girth: 1.5 },                   // L (protected)
  { girth: 2.5 },                   // XL (protected)
  { girth: 3.5 },                   // XL (protected + heritage)
  { girth: null },                  // unknown
  { girth: -1 },                    // cluster
];
const s = summarize(trees);
assert.equal(s.total, 8, 'total trees');
assert.deepEqual(s.byBand, { S: 2, M: 1, L: 1, XL: 2, cluster: 1, unknown: 1 }, 'band counts');
assert.equal(s.protected, 3, 'three protected (1.5, 2.5, 3.5)');
assert.equal(s.heritage, 1, 'one heritage candidate (3.5)');
// replacement = S*1 + M*2 + L*3 + XL*5 = 2 + 2 + 3 + 10 = 17
assert.equal(s.replacement, 17, 'replacement-planting count');

// ── take-off aggregation (drops zero-qty rows) ────────────────────────
const rows = aggregateTakeoff(trees);
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
assert.equal(byId['TO-S'].qty, 2, 'small girth qty');
assert.equal(byId['TO-XL'].qty, 2, 'very large girth qty');
assert.equal(byId['TO-HER'].qty, 1, 'heritage qty');
assert.equal(byId['TO-REP'].qty, 17, 'replacement qty');
assert.ok(rows.every((r) => r.qty > 0), 'no zero-qty rows');
assert.ok(rows.every((r) => r.unit === 'nr'), 'all units nr');

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
