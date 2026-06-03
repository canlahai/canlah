// Critical Path Method (CPM) engine for construction programmes.
//
// This is the real critical-path calculation the programme planner needs —
// not an AI guess. Under PSSCOC the critical path is the basis for Extension
// of Time (EOT) claims, so it has to be computed and defensible.
//
// The core runs in integer WORKING-DAY units (offsets from project start),
// then maps those offsets to real dates via lib/calendar.js so weekends and
// SG public holidays are honoured. v1 supports finish-to-start (FS)
// dependencies with lag; other link types are treated as FS (flagged in
// `warnings`) until later phases.
//
// Task input shape:
//   { id, name?, durationDays, predecessors?: [{ id, type?, lagDays? }] }
// Returns each task annotated with earlyStart/earlyFinish/lateStart/
// lateFinish (dates), start/end (dates), totalFloat (working days),
// onCriticalPath, plus { criticalPathTaskIds, projectStart, projectEnd,
// projectDurationDays, warnings }.

import { makeCalendar, workingDayDate } from './calendar.js';

function topoSort(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indegree = new Map(tasks.map((t) => [t.id, 0]));
  const successors = new Map(tasks.map((t) => [t.id, []]));

  for (const t of tasks) {
    for (const p of t.predecessors || []) {
      if (!byId.has(p.id)) throw new Error(`Task "${t.id}" depends on unknown predecessor "${p.id}"`);
      indegree.set(t.id, indegree.get(t.id) + 1);
      successors.get(p.id).push(t.id);
    }
  }

  const queue = tasks.filter((t) => indegree.get(t.id) === 0).map((t) => t.id);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const s of successors.get(id)) {
      indegree.set(s, indegree.get(s) - 1);
      if (indegree.get(s) === 0) queue.push(s);
    }
  }
  if (order.length !== tasks.length) {
    const cyclic = tasks.filter((t) => !order.includes(t.id)).map((t) => t.id);
    throw new Error(`Dependency cycle detected involving: ${cyclic.join(', ')}`);
  }
  return { order, successors, byId };
}

export function computeSchedule(tasks, { startDate, calendar } = {}) {
  if (!Array.isArray(tasks)) throw new Error('tasks must be an array');
  if (!startDate) throw new Error('startDate (YYYY-MM-DD) is required');
  const cal = calendar || makeCalendar();
  const warnings = [];

  if (tasks.length === 0) {
    return { tasks: [], criticalPathTaskIds: [], projectStart: startDate, projectEnd: startDate, projectDurationDays: 0, warnings };
  }

  const ids = new Set();
  for (const t of tasks) {
    if (!t.id) throw new Error('every task needs an id');
    if (ids.has(t.id)) throw new Error(`duplicate task id "${t.id}"`);
    ids.add(t.id);
    if (!Number.isInteger(t.durationDays) || t.durationDays < 0) {
      throw new Error(`task "${t.id}" durationDays must be a non-negative integer`);
    }
    for (const p of t.predecessors || []) {
      const type = p.type || 'FS';
      if (type !== 'FS') warnings.push(`Link ${p.id}->${t.id} type "${type}" treated as FS (v1 supports FS only)`);
    }
  }

  const { order, successors, byId } = topoSort(tasks);
  const ES = new Map(), EF = new Map(), LS = new Map(), LF = new Map();

  // Forward pass — ES = max(pred EF + lag); EF = ES + duration. (FS)
  for (const id of order) {
    const t = byId.get(id);
    let es = 0;
    for (const p of t.predecessors || []) {
      const lag = p.lagDays || 0;
      es = Math.max(es, EF.get(p.id) + lag);
    }
    ES.set(id, es);
    EF.set(id, es + t.durationDays);
  }

  const projectDuration = Math.max(...order.map((id) => EF.get(id)));

  // Backward pass — LF = min(succ LS - lag); LS = LF - duration.
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const t = byId.get(id);
    const succs = successors.get(id);
    let lf = projectDuration;
    if (succs.length) {
      lf = Infinity;
      for (const sId of succs) {
        const link = (byId.get(sId).predecessors || []).find((p) => p.id === id);
        const lag = link?.lagDays || 0;
        lf = Math.min(lf, LS.get(sId) - lag);
      }
    }
    LF.set(id, lf);
    LS.set(id, lf - t.durationDays);
  }

  // Map working-day offsets to real dates. A task spans [ES, EF); its last
  // occupied working day is EF-1. Zero-duration tasks (milestones) end on
  // their start day.
  const endOffset = (es, ef) => (ef > es ? ef - 1 : es);
  const annotated = tasks.map((t) => {
    const es = ES.get(t.id), ef = EF.get(t.id), ls = LS.get(t.id), lf = LF.get(t.id);
    const totalFloat = ls - es;
    const start = workingDayDate(startDate, es, cal);
    const end = workingDayDate(startDate, endOffset(es, ef), cal);
    return {
      ...t,
      earlyStart: start,
      earlyFinish: end,
      lateStart: workingDayDate(startDate, ls, cal),
      lateFinish: workingDayDate(startDate, endOffset(ls, lf), cal),
      totalFloat,
      onCriticalPath: totalFloat <= 0,
      start,
      end,
    };
  });

  return {
    tasks: annotated,
    criticalPathTaskIds: annotated.filter((t) => t.onCriticalPath).map((t) => t.id),
    projectStart: workingDayDate(startDate, 0, cal),
    projectEnd: workingDayDate(startDate, projectDuration - 1, cal),
    projectDurationDays: projectDuration,
    warnings,
  };
}
