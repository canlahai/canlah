import assert from 'node:assert/strict';
import {
  makeCalendar, isWorkingDay, nextWorkingDay, workingDayDate, workingDaysBetween,
} from '../../lib/calendar.js';

// Default calendar: Mon–Sat working, SG 2026 public holidays.
const cal = makeCalendar();

// 2026-01-01 is a Thursday and a public holiday (New Year's Day).
assert.equal(isWorkingDay('2026-01-01', cal), false, 'New Year holiday is non-working');
assert.equal(isWorkingDay('2026-01-02', cal), true, 'Fri 2 Jan is working');
assert.equal(isWorkingDay('2026-01-03', cal), true, 'Sat 3 Jan is working (Mon–Sat week)');
assert.equal(isWorkingDay('2026-01-04', cal), false, 'Sun 4 Jan is non-working');

// nextWorkingDay snaps forward over Sundays and holidays.
assert.equal(nextWorkingDay('2026-01-04', cal), '2026-01-05', 'Sun -> Mon');
assert.equal(nextWorkingDay('2026-01-01', cal), '2026-01-02', 'holiday Thu -> Fri');

// workingDayDate: index 0 = first working day >= start, then step working days.
assert.equal(workingDayDate('2026-01-02', 0, cal), '2026-01-02', 'index 0 = Fri 2 Jan');
assert.equal(workingDayDate('2026-01-02', 1, cal), '2026-01-03', 'index 1 = Sat 3 Jan');
assert.equal(workingDayDate('2026-01-02', 2, cal), '2026-01-05', 'index 2 skips Sun -> Mon 5 Jan');

// workingDaysBetween counts [start, end): Fri, Sat are working, Sun is not.
assert.equal(workingDaysBetween('2026-01-02', '2026-01-06', cal), 3, 'Fri+Sat+Mon (Sun excluded) = 3');
assert.equal(workingDaysBetween('2026-01-05', '2026-01-05', cal), 0, 'empty range = 0');

// A fully-open calendar (every day works) — used by the CPM test.
const open = makeCalendar({ workweek: [0, 1, 2, 3, 4, 5, 6], holidays: [] });
assert.equal(workingDayDate('2026-01-01', 7, open), '2026-01-08', 'open calendar: offset == calendar days');
assert.equal(isWorkingDay('2026-01-04', open), true, 'open calendar: Sunday works');

console.log('calendar.test.mjs — all assertions passed');
