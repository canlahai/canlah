// Cross-programme intelligence — the "multi-programme" layer.
//
// One main contractor runs several jobs at once. These helpers read EVERY
// programme the user can access, run the real CPM schedule on each, and roll the
// results up three ways:
//   • lookahead()     — what's starting / due in the next N days (the weekly
//                       site-meeting "3-week look-ahead"), across all jobs.
//   • resourceLoad()  — who is committed where, and where they're double-booked.
//   • masterPlan()    — all programmes on one date axis, with cross-project
//                       dependencies and breach detection (linked programmes).
//
// All read-only and derived; no new persistence except cross-project links,
// which live on the activity (activity.externalDeps[]) so there's no migration.

import { accessibleProgrammes } from './programmes.js';
import { computeSchedule } from './cpm.js';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

function normaliseTasks(activities) {
  return (activities || []).map((a) => ({
    id: a.id,
    name: a.name,
    durationDays: Math.max(0, Math.round(Number(a.durationDays) || 0)),
    predecessors: (a.predecessors || []).map((p) =>
      (typeof p === 'string' ? { id: p } : { id: p.id, type: p.type, lagDays: Number(p.lagDays) || 0 })),
  }));
}

/** Schedule one programme → { byId: Map(actId→{start,end,onCriticalPath}), projectStart, projectEnd } or null. */
function scheduleOf(p) {
  const acts = Array.isArray(p.activities) ? p.activities : [];
  if (!acts.length || !p.startDate) return null;
  try {
    const s = computeSchedule(normaliseTasks(acts), { startDate: p.startDate });
    const byId = new Map(s.tasks.map((t) => [t.id, { start: t.start, end: t.end, onCriticalPath: t.onCriticalPath }]));
    return { byId, projectStart: s.projectStart, projectEnd: s.projectEnd };
  } catch { return null; } // cycles / bad deps → unscheduled, skip rather than crash
}

/** Programmes annotated with their schedule (internal helper for the three views). */
async function scheduledProgrammes(userId) {
  const progs = await accessibleProgrammes(userId);
  return progs.map((p) => ({ p, sched: scheduleOf(p) }));
}

/**
 * Activities starting / due within the next `days` (default 21), across every
 * programme. Each item is dated and flagged late (should have started) or
 * overdue (should have finished). Sorted by start date.
 */
export async function lookahead(userId, { days = 21 } = {}) {
  const t = today();
  const horizon = addDays(t, days);
  const out = [];
  for (const { p, sched } of await scheduledProgrammes(userId)) {
    if (!sched) continue;
    for (const a of p.activities || []) {
      if (a.status === 'done') continue;
      const d = sched.byId.get(a.id);
      if (!d) continue;
      const inWindow = d.start <= horizon && d.end >= t; // active or upcoming
      const overdue = d.end < t;                          // slipped past its finish
      if (!inWindow && !overdue) continue;
      out.push({
        programmeId: p.id, programmeName: p.name,
        activityId: a.id, name: a.name || a.id,
        start: d.start, end: d.end,
        status: a.status || 'todo',
        assignee: (a.assignee || '').trim() || null,
        onCriticalPath: !!d.onCriticalPath,
        late: !overdue && d.start < t,   // started window passed, still open
        overdue,
      });
    }
  }
  out.sort((x, y) => (x.start || '').localeCompare(y.start || '') || x.programmeName.localeCompare(y.programmeName));
  return { horizonDays: days, from: t, to: horizon, items: out };
}

/**
 * Who is committed where. Aggregates open activities by assignee across all
 * programmes, with their date ranges, and flags overlaps that span DIFFERENT
 * programmes (double-booking). Sorted by load (most assignments first).
 */
export async function resourceLoad(userId) {
  const byPerson = new Map();
  for (const { p, sched } of await scheduledProgrammes(userId)) {
    if (!sched) continue;
    for (const a of p.activities || []) {
      if (a.status === 'done') continue;
      const who = (a.assignee || '').trim();
      if (!who) continue;
      const d = sched.byId.get(a.id);
      if (!d) continue;
      if (!byPerson.has(who)) byPerson.set(who, []);
      byPerson.get(who).push({
        programmeId: p.id, programmeName: p.name,
        activityId: a.id, name: a.name || a.id,
        start: d.start, end: d.end, onCriticalPath: !!d.onCriticalPath,
      });
    }
  }
  const people = [];
  for (const [who, assignments] of byPerson) {
    assignments.sort((x, y) => (x.start || '').localeCompare(y.start || ''));
    // Overlaps across different programmes = double-booking.
    const clashes = [];
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const A = assignments[i], B = assignments[j];
        if (A.programmeId === B.programmeId) continue;
        if (A.start <= B.end && B.start <= A.end) {
          clashes.push({ a: { programmeName: A.programmeName, name: A.name }, b: { programmeName: B.programmeName, name: B.name } });
        }
      }
    }
    people.push({ who, count: assignments.length, programmes: new Set(assignments.map((x) => x.programmeId)).size, clashes, assignments });
  }
  people.sort((a, b) => b.clashes.length - a.clashes.length || b.count - a.count || a.who.localeCompare(b.who));
  return { people, totalClashes: people.reduce((n, p) => n + p.clashes.length, 0) };
}

/**
 * Master / linked view. All programmes on one date axis, plus cross-project
 * finish-to-start links (an activity's `externalDeps: [{programmeId, activityId}]`
 * means "needs that activity finished first"). A link is `breached` when the
 * successor starts on or before its predecessor finishes. `slackDays` < 0 = late.
 */
export async function masterPlan(userId) {
  const items = await scheduledProgrammes(userId);
  const byProgId = new Map(items.map(({ p, sched }) => [p.id, { p, sched }]));

  const programmes = items.map(({ p, sched }) => ({
    id: p.id, name: p.name,
    start: sched ? sched.projectStart : (p.startDate || null),
    end: sched ? sched.projectEnd : (p.endDate || null),
    scheduled: !!sched,
    activityCount: (p.activities || []).length,
  }));

  const links = [];
  for (const { p, sched } of items) {
    for (const a of p.activities || []) {
      const deps = Array.isArray(a.externalDeps) ? a.externalDeps : [];
      for (const dep of deps) {
        const src = byProgId.get(dep.programmeId);
        if (!src) continue; // predecessor not accessible to this user
        const srcAct = (src.p.activities || []).find((x) => x.id === dep.activityId);
        if (!srcAct) continue;
        const fromDates = src.sched && src.sched.byId.get(dep.activityId);
        const toDates = sched && sched.byId.get(a.id);
        const finish = fromDates ? fromDates.end : null;
        const start = toDates ? toDates.start : null;
        const slackDays = (finish && start) ? dayDiff(start, finish) : null; // start - finish
        links.push({
          from: { programmeId: dep.programmeId, programmeName: src.p.name, activityId: dep.activityId, name: srcAct.name || dep.activityId, finish },
          to: { programmeId: p.id, programmeName: p.name, activityId: a.id, name: a.name || a.id, start },
          slackDays,
          breached: slackDays != null && slackDays <= 0,
        });
      }
    }
  }
  return {
    programmes,
    links,
    breaches: links.filter((l) => l.breached).length,
  };
}
