import assert from 'node:assert/strict';
import { parseMSProjectXML, parseScheduleCSV } from '../../lib/msp-import.js';

// ── MS Project XML (MSPDI) ──────────────────────────────────────────────────
const xml = `<?xml version="1.0"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Imported Tower</Name>
  <StartDate>2026-07-01T08:00:00</StartDate>
  <Tasks>
    <Task><UID>0</UID><Name>Project Summary</Name><Summary>1</Summary></Task>
    <Task><UID>1</UID><Name>Substructure</Name><Summary>1</Summary></Task>
    <Task><UID>2</UID><Name>Bored piling</Name><Duration>PT200H0M0S</Duration><Start>2026-07-01T08:00:00</Start><Finish>2026-07-25T17:00:00</Finish></Task>
    <Task><UID>3</UID><Name>Pile caps</Name><Duration>PT80H0M0S</Duration><Milestone>0</Milestone>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type></PredecessorLink></Task>
    <Task><UID>4</UID><Name>TOP</Name><Duration>PT0H0M0S</Duration><Milestone>1</Milestone>
      <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>1</Type></PredecessorLink></Task>
  </Tasks>
</Project>`;

const r = parseMSProjectXML(xml);
assert.equal(r.name, 'Imported Tower', 'project name parsed');
assert.equal(r.startDate, '2026-07-01', 'start date parsed (date only)');
assert.equal(r.taskCount, 3, 'summaries + UID-0 dropped, 3 leaf tasks kept');
assert.deepEqual(r.activities.map((a) => a.name), ['Bored piling', 'Pile caps', 'TOP'], 'leaf task names');
assert.equal(r.activities[0].durationDays, 25, 'PT200H → 25 working days');
assert.equal(r.activities[2].durationDays, 0, 'PT0H → 0 (milestone)');
assert.equal(r.activities[2].milestone, true, 'milestone flag parsed');
// predecessor UID 2 (Bored piling) → first activity id a1; Pile caps depends on it
const caps = r.activities.find((a) => a.name === 'Pile caps');
assert.deepEqual(caps.predecessors, ['a1'], 'predecessor remapped to our id');
assert.equal(r.linkCount, 2, 'two dependency links');

// non-MSP input → graceful
assert.equal(parseMSProjectXML('hello').taskCount, 0, 'non-XML → empty + warning');
assert.ok(parseMSProjectXML('hello').warnings.length, 'warning emitted');

// ── CSV ─────────────────────────────────────────────────────────────────────
const csv = `ID,Task Name,Duration (days),Predecessors
1,Excavation,10,
2,Foundations,15,1
3,"Columns, RC",12,2`;
const c = parseScheduleCSV(csv);
assert.equal(c.taskCount, 3, 'three CSV rows');
assert.deepEqual(c.activities.map((a) => a.name), ['Excavation', 'Foundations', 'Columns, RC'], 'quoted comma handled');
assert.equal(c.activities[1].durationDays, 15, 'duration parsed');
assert.deepEqual(c.activities[1].predecessors, ['a1'], 'predecessor id 1 → a1');
assert.deepEqual(c.activities[2].predecessors, ['a2'], 'predecessor id 2 → a2');

// CSV without duration column → default 1 day + warning
const c2 = parseScheduleCSV('Activity\nMobilise\nDemolish');
assert.equal(c2.taskCount, 2, 'two rows');
assert.equal(c2.activities[0].durationDays, 1, 'defaulted to 1 day');
assert.ok(c2.warnings.some((w) => /duration/i.test(w)), 'warns about missing duration');

// CSV missing a name column → rejected with a clear warning
assert.ok(parseScheduleCSV('foo,bar\n1,2').warnings.some((w) => /name/i.test(w)), 'needs a name column');

console.log('msp-import.test.mjs — all assertions passed');
