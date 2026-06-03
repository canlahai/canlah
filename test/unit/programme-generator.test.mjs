import assert from 'node:assert/strict';
import { generateProgramme, WBS } from '../../lib/programme-generator.js';

const p = generateProgramme({
  name: 'Test RC Block',
  storeys: 5,
  structuralSystem: 'insitu_rc',
  startDate: '2026-01-02',
});

const byId = Object.fromEntries(p.tasks.map((t) => [t.id, t]));

// Structure
assert.equal(p.wbs.length, 5, 'five standard WBS phases');
assert.deepEqual(p.wbs.map((w) => w.id), ['p1', 'p2', 'p3', 'p4', 'p5'], 'WBS ids in order');
assert.ok(byId['floor-5'] && !byId['floor-6'], '5 storeys -> floor-1..5, no floor-6');

// Regulatory gateways present
const ms = new Set(p.milestones.map((m) => m.id));
for (const g of ['bca-permit', 'scdf', 'top', 'csc']) {
  assert.ok(ms.has(g), `milestone present: ${g}`);
}

// Compliance sequencing: BCA permit gates structural works (piling)
assert.ok(byId['bca-permit'].end <= byId['pile'].start, 'BCA permit before piling');
// TOP before CSC
assert.ok(byId['top'].start <= byId['csc'].start, 'TOP before CSC');
// Enabling before sub-structure
assert.ok(byId['clear'].end <= byId['pile'].start, 'enabling clears before piling');

// Critical path runs through the floor cycle (the dominant chain) and the spine
const crit = new Set(p.criticalPathTaskIds);
assert.ok(crit.has('pile'), 'piling on critical path');
assert.ok(crit.has('floor-3'), 'mid floor on critical path');
assert.ok(crit.has('tc') && crit.has('csc'), 'T&C and CSC on critical path');
// Façade has float (shorter than block->mep->finishes branch feeding T&C)
assert.equal(byId['facade'].onCriticalPath, false, 'facade not critical (has float)');

// Every task carries a duration basis (trust tagging)
assert.ok(p.tasks.every((t) => t.durationBasis), 'all tasks tagged with durationBasis');

// More storeys -> longer programme (scaling works)
const p10 = generateProgramme({ storeys: 10, startDate: '2026-01-02' });
assert.ok(p10.projectDurationDays > p.projectDurationDays, '10 storeys longer than 5');
// Each extra storey adds ~one floor cycle (10 working days)
assert.equal(p10.projectDurationDays - p.projectDurationDays, 50, '5 extra floors = 50 working days');

// Clean network -> no warnings for in-situ RC
assert.equal(p.warnings.length, 0, 'no warnings for in-situ RC');

// Non-RC system warns but still generates
const steel = generateProgramme({ storeys: 3, structuralSystem: 'steel', startDate: '2026-01-02' });
assert.ok(steel.warnings.some((w) => /in-situ RC/.test(w)), 'non-RC system warns');

console.log('programme-generator.test.mjs — all assertions passed');
