import assert from 'node:assert/strict';
import { SAFETY_TYPES, safetyTypeList, buildSafetyPrompt, demoSafetyReport } from '../../lib/safety.js';

// type list
const types = safetyTypeList();
assert.ok(types.find((t) => t.key === 'incident'), 'has incident type');
assert.ok(types.find((t) => t.key === 'near-miss'), 'has near-miss type');
assert.ok(types.length >= 5, 'several report types');

// buildSafetyPrompt — embeds notes, sections, faithfulness guardrail
const p = buildSafetyPrompt({ reportType: 'incident', input: 'worker fall scaffold L3 helmet on no injury' });
assert.ok(p.includes('worker fall scaffold L3'), 'includes the worker notes');
assert.ok(/do NOT invent/i.test(p), 'instructs not to invent facts');
assert.ok(p.includes('"Incident summary"'), 'lists the incident sections');
assert.ok(/JSON/.test(p), 'asks for JSON output');

// template overrides the section set + title
const tmpl = { title: 'ACME Incident Form', sections: [{ heading: 'Site' }, { heading: 'What happened' }, { heading: 'Sign-off' }] };
const pt = buildSafetyPrompt({ reportType: 'incident', input: 'x', template: tmpl });
assert.ok(pt.includes('"Site", "What happened", "Sign-off"'), 'follows the uploaded template sections');
assert.ok(pt.includes('ACME Incident Form'), 'uses the template title');

// demo report — structured, follows type sections, echoes notes
const d = demoSafetyReport({ reportType: 'near-miss', input: 'brick drop level 5 nobody hurt' });
assert.equal(d.title, SAFETY_TYPES['near-miss'].label, 'demo title from type');
assert.equal(d.sections.length, SAFETY_TYPES['near-miss'].sections.length, 'demo sections match type');
assert.ok(d.sections[0].body.includes('brick drop level 5'), 'demo echoes the notes');
assert.ok(d.meta && 'date' in d.meta, 'demo has meta');

// demo with template follows template sections
const dt = demoSafetyReport({ reportType: 'incident', input: 'y', template: tmpl });
assert.deepEqual(dt.sections.map((s) => s.heading), ['Site', 'What happened', 'Sign-off'], 'demo follows template sections');

console.log('safety.test.mjs — all assertions passed');
