// MS Project export (MSPDI XML) for generated programmes.
//
// Produces a .xml that MS Project imports natively and Primavera P6 can read,
// so the planner can take the drafted programme into their own tool, refine,
// and submit the baseline. v1 — the MSPDI schema is finicky across MS Project
// versions; verify the import in your own copy.
//
// Tasks are exported MANUALLY SCHEDULED with the explicit Start/Finish the CPM
// engine computed, so the Mon–Sat + SG-public-holiday schedule displays exactly
// as generated (rather than being recalculated against MS Project's default
// Mon–Fri calendar). WBS phases become summary tasks; the four regulatory
// gateways become milestones; dependencies become finish-to-start links.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const fmtStart = (d) => `${d}T08:00:00`;
const fmtFinish = (d) => `${d}T17:00:00`;
const durHours = (days) => `PT${(days || 0) * 8}H0M0S`;     // 8h working day
const lagTenths = (days) => (days || 0) * 8 * 60 * 10;       // MSPDI lag: tenths of a minute

// Canonical MS Project "Standard" calendar (Mon–Fri). Cosmetic only here, since
// tasks are manually scheduled with explicit dates.
const STANDARD_CALENDAR = `  <Calendars>
    <Calendar>
      <UID>1</UID>
      <Name>Standard</Name>
      <IsBaseCalendar>1</IsBaseCalendar>
      <BaseCalendarUID>-1</BaseCalendarUID>
      <WeekDays>
        <WeekDay><DayType>1</DayType><DayWorking>0</DayWorking></WeekDay>
${[2, 3, 4, 5, 6].map((d) => `        <WeekDay><DayType>${d}</DayType><DayWorking>1</DayWorking><WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes></WeekDay>`).join('\n')}
        <WeekDay><DayType>7</DayType><DayWorking>0</DayWorking></WeekDay>
      </WeekDays>
    </Calendar>
  </Calendars>`;

/** Serialise a generated programme (generateProgramme output) to MSPDI XML. */
export function toMSProjectXML(programme) {
  const project = programme.project || {};
  const start = programme.projectStart || project.startDate;
  const finish = programme.projectEnd || start;
  const wbs = programme.wbs || [];
  const allTasks = programme.tasks || [];

  const byPhase = new Map(wbs.map((w) => [w.id, []]));
  for (const t of allTasks) {
    if (byPhase.has(t.wbsId)) byPhase.get(t.wbsId).push(t);
  }

  // Emission order: phase summary then its children. Assign UID/ID as we go and
  // record id->UID so predecessor links resolve.
  const rows = [];
  const idToUid = new Map();
  let uid = 1, id = 1;
  for (const phase of wbs) {
    const children = byPhase.get(phase.id) || [];
    if (!children.length) continue;
    rows.push({ kind: 'summary', phase, children, uid: uid++, id: id++ });
    for (const t of children) {
      const tu = uid++;
      idToUid.set(t.id, tu);
      rows.push({ kind: 'task', task: t, uid: tu, id: id++ });
    }
  }

  const taskXml = rows.map((r) => {
    if (r.kind === 'summary') {
      const s = r.children.map((c) => c.start).sort()[0];
      const e = r.children.map((c) => c.end).sort().slice(-1)[0];
      return `    <Task>
      <UID>${r.uid}</UID><ID>${r.id}</ID>
      <Name>${esc(r.phase.name)}</Name>
      <OutlineLevel>1</OutlineLevel>
      <Summary>1</Summary>
      <Manual>1</Manual>
      <Start>${fmtStart(s)}</Start><Finish>${fmtFinish(e)}</Finish>
    </Task>`;
    }
    const t = r.task;
    const isMs = (t.durationDays || 0) === 0;
    const preds = (t.predecessors || [])
      .map((p) => {
        const pu = idToUid.get(p.id);
        return pu ? `      <PredecessorLink><PredecessorUID>${pu}</PredecessorUID><Type>1</Type><LinkLag>${lagTenths(p.lagDays)}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>` : '';
      })
      .filter(Boolean)
      .join('\n');
    return `    <Task>
      <UID>${r.uid}</UID><ID>${r.id}</ID>
      <Name>${esc(t.name)}</Name>
      <OutlineLevel>2</OutlineLevel>
      <Manual>1</Manual>
      <Milestone>${isMs ? 1 : 0}</Milestone>
      <Duration>${durHours(t.durationDays)}</Duration>
      <DurationFormat>7</DurationFormat>
      <Start>${fmtStart(t.start)}</Start><Finish>${fmtFinish(t.end)}</Finish>${preds ? '\n' + preds : ''}
    </Task>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion>
  <Name>${esc(project.name || 'CanLah Programme')}</Name>
  <Title>${esc(project.name || 'CanLah Programme')}</Title>
  <Author>CanLah.ai</Author>
  <StartDate>${fmtStart(start)}</StartDate>
  <FinishDate>${fmtFinish(finish)}</FinishDate>
  <CalendarUID>1</CalendarUID>
  <DefaultTaskType>0</DefaultTaskType>
${STANDARD_CALENDAR}
  <Tasks>
${taskXml}
  </Tasks>
</Project>`;
}

/** Filename-safe slug for the export download. */
export function exportFilename(programme) {
  const base = (programme.project?.name || 'programme').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${base || 'programme'}.xml`;
}
