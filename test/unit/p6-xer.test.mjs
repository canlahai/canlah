import assert from 'node:assert/strict';
import { parseXER, toXER } from '../../lib/p6-xer.js';

// ── parse a representative XER ───────────────────────────────────────────────
const xer = [
  'ERMHDR\t19.12\t2026-06-20\tProject\tCanLah\tCanLah\tCanLah\tUSD',
  '%T\tPROJECT',
  '%F\tproj_id\tproj_short_name',
  '%R\t1\tTOWER-A',
  '%T\tTASK',
  '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt\ttarget_start_date',
  '%R\t1001\t1\tA1010\tExcavation\t80\t2026-07-01 08:00',
  '%R\t1002\t1\tA1020\tFoundations\t120\t2026-07-15 08:00',
  '%R\t1003\t1\tMS01\tTOP\t0\t2026-09-01 08:00',
  '%T\tTASKPRED',
  '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt',
  '%R\t5001\t1002\t1001\t1\t1\tPR_FS\t0',
  '%R\t5002\t1003\t1002\t1\t1\tPR_FS\t0',
  '%E',
].join('\n');

const r = parseXER(xer);
assert.equal(r.name, 'TOWER-A', 'project short name parsed');
assert.equal(r.taskCount, 3, 'three tasks');
assert.deepEqual(r.activities.map((a) => a.name), ['Excavation', 'Foundations', 'TOP'], 'task names');
assert.equal(r.activities[0].durationDays, 10, '80hr → 10 days');
assert.equal(r.activities[1].durationDays, 15, '120hr → 15 days');
assert.equal(r.activities[2].durationDays, 0, '0hr → milestone');
assert.equal(r.activities[2].milestone, true, 'milestone flag');
assert.equal(r.activities[0].code, 'A1010', 'P6 task_code preserved');
assert.equal(r.activities[1].predecessors[0].id, 'a1', 'Foundations depends on Excavation');
assert.equal(r.activities[2].predecessors[0].id, 'a2', 'TOP depends on Foundations');
assert.equal(r.linkCount, 2, 'two links');

// non-XER input → graceful
assert.ok(parseXER('hello world').warnings.length, 'non-XER flagged');

// ── round-trip: toXER → parseXER preserves tasks + deps + codes ──────────────
const acts = [
  { id: 'a1', name: 'Excavation', durationDays: 10, predecessors: [], code: 'A1010' },
  { id: 'a2', name: 'Foundations', durationDays: 15, predecessors: [{ id: 'a1', lagDays: 3 }], code: 'A1020' },
  { id: 'a3', name: 'TOP', durationDays: 0, predecessors: [{ id: 'a2', lagDays: 0 }], code: 'MS01' },
];
const out = toXER({ name: 'Round Trip', startDate: '2026-07-01', activities: acts, dates: {} });
assert.ok(out.startsWith('ERMHDR'), 'XER header');
assert.ok(out.includes('%T\tTASK') && out.includes('%T\tTASKPRED'), 'has TASK + TASKPRED tables');
const back = parseXER(out);
assert.equal(back.taskCount, 3, 'round-trip task count');
assert.deepEqual(back.activities.map((a) => a.name), ['Excavation', 'Foundations', 'TOP'], 'round-trip names');
assert.equal(back.linkCount, 2, 'round-trip links');
assert.equal(back.activities[2].durationDays, 0, 'round-trip milestone');
assert.equal(back.activities[0].code, 'A1010', 'round-trip task code');
assert.equal(back.activities[1].predecessors[0].lagDays, 3, 'round-trip predecessor lag (3d)');

console.log('p6-xer.test.mjs — all assertions passed');
