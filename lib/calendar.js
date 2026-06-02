// Working-day calendar for Singapore construction programmes.
//
// NEA noise rules ban noisy work on Sundays and public holidays, and SG
// construction typically runs a Mon–Sat week. So a "working day" here =
// a day in the configured workweek that is not a public holiday. Duration
// math (in lib/cpm.js) counts working days only, so generated dates reflect
// real site time, not idealised calendar days.
//
// Dates are 'YYYY-MM-DD' strings handled in UTC to dodge timezone drift.

// Default workweek: Monday–Saturday working, Sunday off. 0=Sun … 6=Sat.
export const DEFAULT_WORKWEEK = [1, 2, 3, 4, 5, 6];

// Best-effort Singapore 2026 public holidays (with in-lieu Mondays where the
// holiday falls on a Sunday). VERIFY against the official MOM gazette before
// relying on this for a real submission — Islamic holiday dates in particular
// are announced and can shift by a day.
export const SG_PUBLIC_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-02-17', // Chinese New Year
  '2026-02-18', // Chinese New Year
  '2026-03-21', // Hari Raya Puasa (verify)
  '2026-04-03', // Good Friday
  '2026-05-01', // Labour Day
  '2026-05-27', // Hari Raya Haji (verify)
  '2026-06-01', // Vesak Day observed (falls Sun 31 May)
  '2026-08-10', // National Day observed (falls Sun 9 Aug)
  '2026-11-09', // Deepavali observed (falls Sun 8 Nov)
  '2026-12-25', // Christmas Day
];

// ── date helpers (UTC) ────────────────────────────────────────────────
function parse(str) {
  const [y, m, d] = str.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function toStr(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
const DAY_MS = 24 * 3600 * 1000;
function addDays(str, n) { return toStr(parse(str) + n * DAY_MS); }
function dayOfWeek(str) { return new Date(parse(str)).getUTCDay(); }

/**
 * Build a calendar. `holidays` may be a list/Set of 'YYYY-MM-DD'.
 * `workweek` is a list of weekday numbers (0=Sun..6=Sat) that are working.
 */
export function makeCalendar({ workweek = DEFAULT_WORKWEEK, holidays = SG_PUBLIC_HOLIDAYS_2026 } = {}) {
  return {
    workdays: new Set(workweek),
    holidays: holidays instanceof Set ? holidays : new Set(holidays),
  };
}

export function isWorkingDay(str, cal) {
  return cal.workdays.has(dayOfWeek(str)) && !cal.holidays.has(str);
}

/** First working day on or after `str`. */
export function nextWorkingDay(str, cal) {
  let d = str;
  // Guard against an empty/over-restricted workweek causing an infinite loop.
  for (let i = 0; i < 3650; i++) {
    if (isWorkingDay(d, cal)) return d;
    d = addDays(d, 1);
  }
  throw new Error('No working day found within 10 years — check workweek/holidays');
}

/**
 * Date of the `index`-th working day on/after `start` (index 0 = first
 * working day >= start). Used to map CPM integer working-day offsets to
 * real calendar dates.
 */
export function workingDayDate(start, index, cal) {
  if (index < 0) throw new Error('index must be >= 0');
  let d = nextWorkingDay(start, cal);
  for (let count = 0; count < index; count++) {
    d = nextWorkingDay(addDays(d, 1), cal);
  }
  return d;
}

/** Count of working days in [start, end) — i.e. excludes `end`. */
export function workingDaysBetween(start, end, cal) {
  if (parse(end) <= parse(start)) return 0;
  let count = 0;
  let d = start;
  while (parse(d) < parse(end)) {
    if (isWorkingDay(d, cal)) count++;
    d = addDays(d, 1);
  }
  return count;
}

export const _internal = { parse, toStr, addDays, dayOfWeek };
