import assert from 'node:assert/strict';
import { generateProgramme } from '../../lib/programme-generator.js';
import { toMSProjectXML, exportFilename } from '../../lib/msp-export.js';

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

console.log('msp-export.test.mjs — all assertions passed');
