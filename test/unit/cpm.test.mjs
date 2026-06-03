import assert from 'node:assert/strict';
import { computeSchedule } from '../../lib/cpm.js';
import { makeCalendar } from '../../lib/calendar.js';

// Fully-open calendar so working-day offsets == calendar days (easy to verify).
const open = makeCalendar({ workweek: [0, 1, 2, 3, 4, 5, 6], holidays: [] });

// Diamond network — hand-computed:
//   A(3) -> B(2) -> D(1)
//   A(3) -> C(4) -> D(1)
// Forward: A[0,3] B[3,5] C[3,7] D[7,8]  -> duration 8
// Floats:  A=0(crit) B=2 C=0(crit) D=0(crit)  -> critical path A,C,D
const network = [
  { id: 'A', name: 'Site set-up', durationDays: 3 },
  { id: 'B', name: 'Hoarding', durationDays: 2, predecessors: [{ id: 'A' }] },
  { id: 'C', name: 'Piling', durationDays: 4, predecessors: [{ id: 'A' }] },
  { id: 'D', name: 'Pile cap', durationDays: 1, predecessors: [{ id: 'B' }, { id: 'C' }] },
];

const r = computeSchedule(network, { startDate: '2026-01-01', calendar: open });
const byId = Object.fromEntries(r.tasks.map((t) => [t.id, t]));

assert.equal(r.projectDurationDays, 8, 'project duration is 8 working days');
assert.deepEqual([...r.criticalPathTaskIds].sort(), ['A', 'C', 'D'], 'critical path = A,C,D');

assert.equal(byId.A.totalFloat, 0, 'A is critical (0 float)');
assert.equal(byId.B.totalFloat, 2, 'B has 2 days float');
assert.equal(byId.C.totalFloat, 0, 'C is critical');
assert.equal(byId.D.totalFloat, 0, 'D is critical');
assert.equal(byId.B.onCriticalPath, false, 'B not on critical path');

// Date mapping (open calendar => offset == day count from start).
assert.equal(byId.A.start, '2026-01-01', 'A starts at project start');
assert.equal(byId.A.end, '2026-01-03', 'A (3d) ends on day 3');
assert.equal(byId.D.end, '2026-01-08', 'D ends on project end');
assert.equal(r.projectEnd, '2026-01-08', 'projectEnd matches last working day');

// Milestone (duration 0) sits at its predecessor's finish, start == end.
const withMs = computeSchedule(
  [...network, { id: 'M', name: 'Foundation complete', durationDays: 0, predecessors: [{ id: 'D' }] }],
  { startDate: '2026-01-01', calendar: open },
);
const ms = withMs.tasks.find((t) => t.id === 'M');
assert.equal(ms.start, ms.end, 'milestone start == end');
assert.equal(ms.start, '2026-01-09', 'milestone falls the day after D finishes');

// NEA calendar: a 3-day task from a Saturday skips Sunday.
const nea = computeSchedule(
  [{ id: 'X', durationDays: 3 }],
  { startDate: '2026-01-03', calendar: makeCalendar() }, // Sat start, Mon–Sat week
);
assert.equal(nea.tasks[0].start, '2026-01-03', 'X starts Sat 3 Jan');
assert.equal(nea.tasks[0].end, '2026-01-06', 'X (3 working days) skips Sun -> ends Tue 6 Jan');

// Guard rails.
assert.throws(
  () => computeSchedule([{ id: 'A', durationDays: 1, predecessors: [{ id: 'A' }] }], { startDate: '2026-01-01' }),
  /cycle/i, 'self-cycle detected',
);
assert.throws(
  () => computeSchedule([{ id: 'A', durationDays: 1, predecessors: [{ id: 'Z' }] }], { startDate: '2026-01-01' }),
  /unknown predecessor/i, 'unknown predecessor rejected',
);

// Non-FS link type is accepted but flagged.
const ss = computeSchedule(
  [{ id: 'A', durationDays: 2 }, { id: 'B', durationDays: 2, predecessors: [{ id: 'A', type: 'SS' }] }],
  { startDate: '2026-01-01', calendar: open },
);
assert.ok(ss.warnings.some((w) => /treated as FS/.test(w)), 'SS link produces a warning');

console.log('cpm.test.mjs — all assertions passed');
