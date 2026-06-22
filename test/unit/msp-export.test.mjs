import assert from 'node:assert/strict';
import { generateProgramme } from '../../lib/programme-generator.js';
import { toMSProjectXML, exportFilename, activitiesToMSProjectXML } from '../../lib/msp-export.js';
import { parseMSProjectXML } from '../../lib/msp-import.js';

const p = generateProgramme({ name: 'Test & Co Tower', storeys: 3, startDate: '2026-01-02' });
const xml = toMSProjectXML(p);

// Well-formed MSPDI shell
assert.ok(xml.startsWith('<?xml'), 'has XML declaration');
assert.ok(xml.includes('xmlns="http://schemas.microsoft.com/project"'), 'MSPDI namespace');
assert.ok(xml.includes('<Calendars>') && xml.includes('</Calendars>'), 'calendar block present');

// Balanced Task tags
const open = (xml.match(/<Task>/g) || []).length;
const close = (xml.match(/<\/Task>/g) || []).length;
assert.equal(open, close, 'balanced <Task> tags');

// 5 phase summaries (all phases non-empty) + every generated task
assert.equal(open, p.tasks.length + 5, 'summaries + all tasks emitted');
assert.equal((xml.match(/<Summary>1<\/Summary>/g) || []).length, 5, 'five WBS summary tasks');

// Four regulatory gateways exported as milestones
assert.equal((xml.match(/<Milestone>1<\/Milestone>/g) || []).length, 4, 'four milestone flags');

// Dependencies exported as finish-to-start links
assert.ok(xml.includes('<PredecessorLink>'), 'has predecessor links');
assert.ok(xml.includes('<Type>1</Type>'), 'finish-to-start link type');

// XML-escaping of the project name (& -> &amp;)
assert.ok(xml.includes('<Name>Test &amp; Co Tower</Name>'), 'project name escaped');
assert.ok(!/<Name>[^<]*&(?!amp;|lt;|gt;|quot;)/.test(xml), 'no unescaped ampersands in names');

// Dates carry the generated schedule (manually scheduled, explicit Start/Finish)
assert.ok(xml.includes('<Start>2026-01-02T08:00:00</Start>'), 'project start present on a task');
assert.ok(xml.includes('<Manual>1</Manual>'), 'tasks manually scheduled');

// Filename slug
assert.equal(exportFilename(p), 'test-co-tower.xml', 'filename slug');

// ── collaborative activity-shape export + round-trip (export → import) ───────
const acts = [
  { id: 'a1', name: 'Cast slab L3', section: 'Superstructure', durationDays: 8, predecessors: [] },
  { id: 'a2', name: 'Strip & cure', section: 'Superstructure', durationDays: 3, predecessors: ['a1'] },
  { id: 'a3', name: 'TOP inspection', section: 'Handover', durationDays: 0, predecessors: ['a2'] },
];
const dates = { a1: { start: '2026-07-01', end: '2026-07-10' }, a2: { start: '2026-07-11', end: '2026-07-15' }, a3: { start: '2026-07-16', end: '2026-07-16' } };
const cx = activitiesToMSProjectXML({ name: 'Collab & Co', startDate: '2026-07-01', activities: acts, dates });
assert.ok(cx.startsWith('<?xml') && cx.includes('schemas.microsoft.com/project'), 'activity export is MSPDI');
assert.equal((cx.match(/<Task>/g) || []).length, (cx.match(/<\/Task>/g) || []).length, 'balanced task tags');
assert.equal((cx.match(/<Summary>1<\/Summary>/g) || []).length, 2, 'two section summaries');
assert.ok(cx.includes('<Milestone>1</Milestone>'), 'zero-duration → milestone');
assert.ok(cx.includes('<Name>Collab &amp; Co</Name>'), 'name escaped');

// Round-trip: the XML we emit must parse back to the same tasks + a dependency.
const back = parseMSProjectXML(cx);
assert.equal(back.taskCount, 3, 'round-trip preserves the 3 leaf tasks (summaries dropped)');
assert.deepEqual(back.activities.map((a) => a.name), ['Cast slab L3', 'Strip & cure', 'TOP inspection'], 'names survive round-trip');
assert.ok(back.linkCount >= 2, 'dependencies survive round-trip');
const a2 = back.activities.find((a) => a.name === 'Strip & cure');
assert.equal(a2.predecessors.length, 1, 'a2 keeps one predecessor');
assert.equal(back.activities.find((a) => a.name === 'TOP inspection').durationDays, 0, 'milestone duration 0');

// UID-preserving round-trip: imported MSP UIDs survive re-export (stable identity).
const withUids = [
  { id: 'a1', name: 'Piling', section: '', durationDays: 10, predecessors: [], mspUid: '42' },
  { id: 'a2', name: 'Caps', section: '', durationDays: 5, predecessors: ['a1'], mspUid: '57' },
  { id: 'a3', name: 'New CanLah task', section: '', durationDays: 3, predecessors: ['a2'] }, // no mspUid
];
const ux = activitiesToMSProjectXML({ name: 'UID', startDate: '2026-07-01', activities: withUids, dates: {} });
assert.ok(ux.includes('<UID>42</UID>') && ux.includes('<UID>57</UID>'), 'preserved UIDs re-emitted');
// Task UIDs (inside <Tasks>, excluding the calendar UID) must be unique.
const tasksBlock = ux.slice(ux.indexOf('<Tasks>'));
const uids = (tasksBlock.match(/<UID>(\d+)<\/UID>/g) || []).map((m) => m.replace(/\D/g, ''));
assert.equal(uids.length, 3, 'three task UIDs emitted');
assert.equal(new Set(uids).size, uids.length, 'task UIDs unique (new task got a non-colliding UID)');
const uback = parseMSProjectXML(ux);
assert.equal(uback.activities.find((a) => a.name === 'Caps').predecessors[0].id, 'a1', 'dep survives UID round-trip');

// Lead/lag survives export → import.
const lagx = activitiesToMSProjectXML({ name: 'Lag', startDate: '2026-07-01', activities: [
  { id: 'a1', name: 'First', section: '', durationDays: 5, predecessors: [] },
  { id: 'a2', name: 'Second', section: '', durationDays: 5, predecessors: [{ id: 'a1', lagDays: 3 }] },
], dates: {} });
const lback = parseMSProjectXML(lagx);
assert.equal(lback.activities.find((a) => a.name === 'Second').predecessors[0].lagDays, 3, 'predecessor lag (3d) survives MSP round-trip');

console.log('msp-export.test.mjs — all assertions passed');
