import assert from 'node:assert/strict';
import { estimateDurationDays, normUnit, bqToActivities } from '../../lib/productivity.js';

// --- unit normalisation -----------------------------------------------------
assert.equal(normUnit('M³'), 'm3', 'm³ → m3');
assert.equal(normUnit('Sqm'), 'm2', 'sqm → m2');
assert.equal(normUnit('Nr'), 'no', 'nr → no');
assert.equal(normUnit('Tonnes'), 'tonne', 'tonnes → tonne');

// --- duration estimates -----------------------------------------------------
assert.equal(estimateDurationDays({ trade: 'concrete', quantity: 400, unit: 'm3' }), 10, '400 m3 / 40 per day = 10');
assert.equal(estimateDurationDays({ trade: 'formwork', quantity: 4200, unit: 'm2' }), 35, '4200 m2 / 120 = 35');
assert.equal(estimateDurationDays({ trade: 'rebar', quantity: 85, unit: 'tonne' }), 34, '85 t / 2.5 = 34');
assert.equal(estimateDurationDays({ trade: 'concrete', quantity: 5, unit: 'm3' }), 1, 'tiny qty floors at 1 day');
assert.equal(estimateDurationDays({ trade: 'other', quantity: 10, unit: 'sum' }), null, 'no rate for sum → null');
assert.equal(estimateDurationDays({ trade: 'concrete', quantity: 0, unit: 'm3' }), null, 'zero qty → null');
// fallback by unit when trade has no specific rate
assert.equal(estimateDurationDays({ trade: 'mystery', quantity: 300, unit: 'm2' }), 3, 'unit fallback m2=100/day');

// --- bqToActivities: sequenced draft programme ------------------------------
const { activities, skipped } = bqToActivities([
  { description: 'Painting to walls', trade: 'painting', quantity: 3000, unit: 'm2' },   // arch
  { description: 'RC to columns', trade: 'concrete', quantity: 400, unit: 'm3' },         // super
  { description: 'Bored piles', trade: 'piling', quantity: 40, unit: 'no' },              // sub
  { description: 'Provisional sum', trade: 'other', quantity: 1, unit: 'sum' },           // unestimable
]);
assert.equal(skipped, 1, 'unestimable item skipped');
assert.equal(activities.length, 3, 'three estimable activities');
assert.equal(activities[0].trade, 'piling', 'sequenced: substructure first');
assert.equal(activities[1].trade, 'concrete', 'then superstructure');
assert.equal(activities[2].trade, 'painting', 'then architectural');
assert.equal(activities[0].section, 'Substructure', 'phase/section labelled');
assert.deepEqual(activities[0].predecessors, [], 'first has no predecessor');
assert.deepEqual(activities[1].predecessors, ['a1'], 'chained finish-to-start');
assert.ok(activities.every((a) => a.durationDays >= 1), 'every activity has a duration');

console.log('productivity.test.mjs — all assertions passed');
