import assert from 'node:assert/strict';
import { suggestChecklist, templateItems, listTemplates, itemsToChecklist } from '../../lib/checklist-templates.js';

// --- keyword matching -------------------------------------------------------
assert.equal(suggestChecklist('Cast slab to L3', 'Structural').key, 'concrete-cast', 'cast slab → concrete');
assert.equal(suggestChecklist('RC beam', '').key, 'concrete-cast', 'RC → concrete');
assert.equal(suggestChecklist('Bore pile P12', '').key, 'piling', 'bore pile → piling');
assert.equal(suggestChecklist('Bulk excavation', '').key, 'excavation', 'excavation matched');
assert.equal(suggestChecklist('Waterproofing to basement', '').key, 'waterproofing', 'waterproofing matched');
assert.equal(suggestChecklist('Install conduit', 'M&E').key, 'mep', 'M&E matched');
assert.equal(suggestChecklist('Something unusual', '').key, 'generic', 'no match → generic');

// --- suggestion returns usable items ----------------------------------------
const s = suggestChecklist('Cast slab', '');
assert.ok(s.items.length >= 4, 'concrete template has several items');
assert.ok(s.items.some((i) => /formwork/i.test(i)), 'includes formwork');
assert.ok(s.items.some((i) => /rebar|reinforc/i.test(i)), 'includes rebar');

// --- templateItems / listTemplates ------------------------------------------
assert.ok(templateItems('piling').length > 0, 'piling items by key');
assert.deepEqual(templateItems('does-not-exist'), [], 'unknown key → []');
const all = listTemplates();
assert.ok(all.some((t) => t.key === 'generic'), 'generic is offered in the picker');
assert.ok(all.every((t) => t.key && t.label), 'templates have key + label');

// --- itemsToChecklist -------------------------------------------------------
const cl = itemsToChecklist(['A', 'B']);
assert.equal(cl.length, 2, 'two items');
assert.equal(cl[0].status, 'pending', 'items start pending');
assert.ok(cl[0].id && cl[1].id && cl[0].id !== cl[1].id, 'unique ids');

console.log('checklist-templates.test.mjs — all assertions passed');
