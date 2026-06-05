import assert from 'node:assert/strict';
import { deepEqualish, scoreExpect } from '../score.mjs';

// --- deepEqualish -----------------------------------------------------------
assert.equal(deepEqualish(1, 1), true, 'equal numbers');
assert.equal(deepEqualish(0.1 + 0.2, 0.3), true, 'float tolerance');
assert.equal(deepEqualish(1, 2), false, 'unequal numbers');
assert.equal(deepEqualish('a', 'a'), true, 'equal strings');
assert.equal(deepEqualish(true, true), true, 'equal booleans');
assert.equal(deepEqualish([1, 2], [1, 2]), true, 'equal arrays');
assert.equal(deepEqualish([1, 2], [1, 3]), false, 'unequal arrays');
assert.equal(deepEqualish({ a: 1, b: 2 }, { a: 1 }), true, 'subset object match (only asserted keys)');
assert.equal(deepEqualish({ a: 1 }, { a: 2 }), false, 'object value mismatch');
assert.equal(deepEqualish(undefined, 1), false, 'missing got value');

// --- scoreExpect ------------------------------------------------------------
const ok = scoreExpect({ x: 10, y: true, z: 'a', extra: 99 }, { x: 10, y: true, z: 'a' });
assert.equal(ok.pass, true, 'all asserted keys match (extras ignored)');
assert.deepEqual(ok.mismatches, [], 'no mismatches');

const bad = scoreExpect({ x: 10, y: false }, { x: 11, y: true });
assert.equal(bad.pass, false, 'mismatch detected');
assert.equal(bad.mismatches.length, 2, 'both mismatches reported');
assert.deepEqual(bad.mismatches.find((m) => m.key === 'x'), { key: 'x', want: 11, got: 10 }, 'mismatch carries want/got');

// nested object expectation (e.g. tree byBand)
const nested = scoreExpect({ byBand: { S: 1, M: 2, X: 9 } }, { byBand: { S: 1, M: 2 } });
assert.equal(nested.pass, true, 'nested subset object matches');

console.log('eval/engines/test/score.test.mjs — all assertions passed');
