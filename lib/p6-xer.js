// Primavera P6 interop via XER (P6's tab-delimited text interchange format).
//
// XER structure:
//   ERMHDR\t<version>\t...                      (header)
//   %T\t<TABLE>                                  (table start)
//   %F\t<col1>\t<col2>...                        (field names)
//   %R\t<val1>\t<val2>...                        (a row)
//   %E                                           (end)
//
// We parse the TASK + TASKPRED tables → CanLah activities, and generate a
// minimal XER that P6 can import. Zero dependencies (Node + browser). XER is
// version-sensitive and P6 is picky — treat export as BETA and verify in P6.

const dateOnly = (s) => (String(s || '').match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
const durDays = (hr) => { const h = Number(hr); return isFinite(h) ? Math.max(0, Math.round(h / 8)) : 0; };

/** Parse an XER string into the shared import shape. */
export function parseXER(text) {
  const warnings = [];
  const lines = String(text || '').split(/\r?\n/);
  if (!lines[0] || !/^ERMHDR/.test(lines[0])) {
    // Not strictly fatal, but flag it.
    if (!/%T\tTASK/.test(String(text || ''))) return { name: null, startDate: null, activities: [], taskCount: 0, linkCount: 0, warnings: ['Not a Primavera XER file'] };
  }
  const tables = {};
  let cur = null, fields = null;
  for (const line of lines) {
    if (!line) continue;
    const cols = line.split('\t');
    const tag = cols[0];
    if (tag === '%T') { cur = cols[1]; tables[cur] = { fields: [], rows: [] }; fields = null; }
    else if (tag === '%F' && cur) { fields = cols.slice(1); tables[cur].fields = fields; }
    else if (tag === '%R' && cur && fields) { const row = {}; cols.slice(1).forEach((v, i) => { row[fields[i]] = v; }); tables[cur].rows.push(row); }
    else if (tag === '%E') break;
  }

  const taskT = tables.TASK;
  if (!taskT || !taskT.rows.length) return { name: null, startDate: null, activities: [], taskCount: 0, linkCount: 0, warnings: ['No TASK table found in the XER'] };

  const projName = (tables.PROJECT && tables.PROJECT.rows[0] && (tables.PROJECT.rows[0].proj_short_name || tables.PROJECT.rows[0].proj_id)) || null;
  const tasks = taskT.rows.filter((r) => r.task_name);
  const idMap = new Map(tasks.map((t, i) => [t.task_id, 'a' + (i + 1)]));

  const predBy = new Map();
  for (const p of (tables.TASKPRED ? tables.TASKPRED.rows : [])) {
    if (!predBy.has(p.task_id)) predBy.set(p.task_id, []);
    predBy.get(p.task_id).push({ pid: p.pred_task_id, lag: Number(p.lag_hr_cnt) || 0 });
  }

  let linkCount = 0;
  const activities = tasks.map((t, i) => {
    const days = durDays(t.target_drtn_hr_cnt);
    const preds = (predBy.get(t.task_id) || []).map((x) => ({ id: idMap.get(x.pid), lagDays: Math.round(x.lag / 8) })).filter((p) => p.id);
    linkCount += preds.length;
    return { id: 'a' + (i + 1), name: t.task_name, durationDays: days, predecessors: preds, section: '', code: t.task_code || '', milestone: days === 0 };
  });
  const startDate = dateOnly(tasks.map((t) => t.target_start_date || t.act_start_date).filter(Boolean).sort()[0]);
  return { name: projName, startDate, activities, taskCount: activities.length, linkCount, warnings };
}

// ── export (BETA) ───────────────────────────────────────────────────────────
const xdate = (d, t) => (d ? `${d} ${t}` : '');

/**
 * Serialise a programme to a minimal XER. BETA — P6 import is version-sensitive;
 * verify in your copy. { name, startDate, activities:[{id,name,durationDays,
 * predecessors:[id],code,milestone}], dates:{id:{start,end}} }
 */
export function toXER({ name = 'CanLah Programme', startDate, activities = [], dates = {} } = {}) {
  const get = (id) => dates[id] || {};
  const PROJ = 1, CAL = 1;
  // Allocate P6 task_ids; preserve original numeric code where it looks like one.
  let nextTask = 1000;
  const taskId = new Map();
  for (const a of activities) taskId.set(a.id, nextTask++);

  const tableProject = [
    '%T\tPROJECT',
    '%F\tproj_id\tproj_short_name\tplan_start_date\tlast_recalc_date\tclndr_id',
    `%R\t${PROJ}\t${esc(name).slice(0, 20)}\t${xdate(startDate, '08:00')}\t${xdate(startDate, '08:00')}\t${CAL}`,
  ].join('\n');

  const tableCal = [
    '%T\tCALENDAR',
    '%F\tclndr_id\tclndr_name\tday_hr_cnt\tweek_hr_cnt',
    `%R\t${CAL}\tStandard (SG)\t8\t48`,
  ].join('\n');

  const taskRows = activities.map((a) => {
    const d = get(a.id);
    const hrs = Math.max(0, Math.round(Number(a.durationDays) || 0)) * 8;
    const type = (Number(a.durationDays) || 0) === 0 ? 'TT_Mile' : 'TT_Task';
    return `%R\t${taskId.get(a.id)}\t${PROJ}\t${CAL}\t${esc(a.code || ('A' + taskId.get(a.id)))}\t${esc(a.name)}\t${type}\t${hrs}\t${xdate(d.start || startDate, '08:00')}\t${xdate(d.end || d.start || startDate, '17:00')}`;
  }).join('\n');
  const tableTask = [
    '%T\tTASK',
    '%F\ttask_id\tproj_id\tclndr_id\ttask_code\ttask_name\ttask_type\ttarget_drtn_hr_cnt\ttarget_start_date\ttarget_end_date',
    taskRows,
  ].join('\n');

  let predId = 5000;
  const predRows = [];
  for (const a of activities) {
    for (const p of (a.predecessors || [])) {
      const pid = typeof p === 'string' ? p : p.id;
      const lagHr = (typeof p === 'string' ? 0 : (Number(p.lagDays) || 0)) * 8;
      if (!taskId.has(pid)) continue;
      predRows.push(`%R\t${predId++}\t${taskId.get(a.id)}\t${taskId.get(pid)}\t${PROJ}\t${PROJ}\tPR_FS\t${lagHr}`);
    }
  }
  const tablePred = [
    '%T\tTASKPRED',
    '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt',
    ...(predRows.length ? [predRows.join('\n')] : []),
  ].join('\n');

  const stamp = new Date().toISOString().slice(0, 10);
  return [
    `ERMHDR\t19.12\t${stamp}\tProject\tCanLah\tCanLah.ai\tCanLah\tUSD`,
    tableProject, tableCal, tableTask, tablePred, '%E', '',
  ].join('\n');
}

// XER values are tab-delimited; strip tabs/newlines from free text.
function esc(s) { return String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').trim(); }
