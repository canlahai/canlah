import assert from 'node:assert/strict';
import {
  scoreDuration,
  scoreCriticalPath,
  scoreGateways,
  scoreWbs,
  scoreFixture,
} from '../score.mjs';
import { generateProgramme } from '../../lib/programme-generator.js';

// --- scoreDuration ---------------------------------------------------------
assert.equal(scoreDuration(100, 100).pass, true, 'exact match passes');
assert.equal(scoreDuration(115, 100, 0.15).pass, true, '+15% is within tolerance');
assert.equal(scoreDuration(116, 100, 0.15).pass, false, '+16% exceeds tolerance');
assert.equal(scoreDuration(85, 100, 0.15).pass, true, '-15% is within tolerance');
assert.equal(scoreDuration(50, 0).pass, false, 'zero expected never passes');
assert.equal(scoreDuration(120, 100).errorPct, 20, 'error pct reported');

// --- scoreCriticalPath -----------------------------------------------------
let cp = scoreCriticalPath(['a', 'b', 'c'], ['a', 'b', 'c']);
assert.equal(cp.pass, true, 'identical CP -> overlap 1');
assert.equal(cp.overlap, 1, 'jaccard 1 for identical sets');

cp = scoreCriticalPath(['a', 'b', 'c', 'd'], ['a', 'b', 'c']);
// intersection 3, union 4 -> 0.75
assert.equal(cp.overlap, 0.75, 'extra generated task lowers jaccard');
assert.equal(cp.recall, 1, 'recall still 1 (all expected caught)');
assert.deepEqual(cp.extra, ['d'], 'extra task surfaced');
assert.equal(cp.pass, true, '0.75 >= 0.6 passes');

cp = scoreCriticalPath(['a'], ['a', 'b', 'c']);
// intersection 1, union 3 -> 0.333
assert.equal(cp.pass, false, 'low overlap fails');
assert.deepEqual(cp.missing, ['b', 'c'], 'missing tasks surfaced');

// --- scoreGateways + scoreWbs on a real generated programme ----------------
const prog = generateProgramme({ storeys: 5, structuralSystem: 'insitu_rc', startDate: '2026-01-02' });

const gw = scoreGateways(prog);
assert.equal(gw.pass, true, 'generated programme has all 4 gateways, sequenced');
assert.deepEqual(gw.missing, [], 'no missing gateways');
assert.ok(gw.sequencing.every((c) => c.ok), 'all sequencing rules hold');

const gwMissing = scoreGateways(prog, ['bca-permit', 'scdf', 'top', 'csc', 'nonexistent']);
assert.equal(gwMissing.pass, false, 'missing expected gateway fails');
assert.deepEqual(gwMissing.missing, ['nonexistent'], 'reports the missing one');

assert.equal(scoreWbs(prog, ['p1', 'p2', 'p3', 'p4', 'p5']).pass, true, 'full WBS covered');
const wbsMiss = scoreWbs(prog, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
assert.equal(wbsMiss.pass, false, 'uncovered phase fails');
assert.deepEqual(wbsMiss.missing, ['p6'], 'reports uncovered phase');

// --- scoreFixture end-to-end ----------------------------------------------
// A fixture whose expected exactly matches the generator should pass all four.
const selfRef = {
  id: 'self-ref',
  status: 'synthetic',
  expected: {
    totalDurationDays: prog.projectDurationDays,
    criticalPathTaskIds: prog.criticalPathTaskIds,
    gateways: ['bca-permit', 'scdf', 'top', 'csc'],
    wbsIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
  },
};
const card = scoreFixture(prog, selfRef);
assert.equal(card.pass, true, 'self-referential fixture passes every metric');
assert.equal(card.status, 'synthetic', 'status carried through');
assert.ok(
  ['duration', 'criticalPath', 'gateways', 'wbs'].every((k) => k in card.results),
  'all four metric scorecards present'
);

console.log('eval/test/score.test.mjs — all assertions passed');
