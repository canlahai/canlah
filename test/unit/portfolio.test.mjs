import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Local-JSON store in a throwaway dir BEFORE import.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
process.env.DEV_PROGRAMMES_DIR = mkdtempSync(join(tmpdir(), 'canlah-portfolio-'));

const { createProgramme } = await import('../../lib/programmes.js');
const { lookahead, resourceLoad, masterPlan } = await import('../../lib/portfolio.js');

const USER = 'u-pf';
const today = new Date().toISOString().slice(0, 10);

// Programme A — Ah Seng on a1; a2 follows a1.
const A = await createProgramme({
  name: 'Tower A', ownerId: USER, startDate: today,
  activities: [
    { id: 'a1', name: 'Cast slab', durationDays: 5, predecessors: [], status: 'in_progress', assignee: 'Ah Seng' },
    { id: 'a2', name: 'Strip formwork', durationDays: 3, predecessors: [{ id: 'a1' }], status: 'todo', assignee: 'Lim' },
  ],
});
// Programme B — Ah Seng on b1 (overlaps A.a1 → double-booked); b1 needs A.a1 first.
const B = await createProgramme({
  name: 'Carpark B', ownerId: USER, startDate: today,
  activities: [
    { id: 'b1', name: 'Deck pour', durationDays: 6, predecessors: [], status: 'todo', assignee: 'Ah Seng',
      externalDeps: [{ programmeId: A.id, activityId: 'a1' }] },
  ],
});

// --- look-ahead -------------------------------------------------------------
const la = await lookahead(USER, { days: 21 });
assert.equal(la.horizonDays, 21, 'horizon echoed');
const names = la.items.map((i) => i.name);
assert.ok(names.includes('Cast slab'), 'look-ahead surfaces an in-window activity');
assert.ok(names.includes('Deck pour'), 'look-ahead spans programmes');
assert.ok(la.items.every((i) => i.status !== 'done'), 'done activities excluded');
const slab = la.items.find((i) => i.name === 'Cast slab');
assert.equal(slab.assignee, 'Ah Seng', 'look-ahead carries assignee');
assert.equal(slab.programmeName, 'Tower A', 'look-ahead carries programme');
assert.ok(slab.start && slab.end, 'look-ahead items are dated');

// --- resource load ----------------------------------------------------------
const rl = await resourceLoad(USER);
const seng = rl.people.find((p) => p.who === 'Ah Seng');
assert.ok(seng, 'Ah Seng appears in resource load');
assert.equal(seng.count, 2, 'Ah Seng has two open assignments');
assert.equal(seng.programmes, 2, 'across two programmes');
assert.equal(seng.clashes.length, 1, 'overlapping cross-programme assignments flagged as a clash');
assert.ok(rl.totalClashes >= 1, 'total clashes counted');
const lim = rl.people.find((p) => p.who === 'Lim');
assert.equal(lim.clashes.length, 0, 'single-programme assignee has no clash');

// --- master plan (cross-project links) --------------------------------------
const mp = await masterPlan(USER);
assert.equal(mp.programmes.length, 2, 'both programmes on the master timeline');
assert.ok(mp.programmes.every((p) => p.start && p.end), 'programmes are dated');
assert.equal(mp.links.length, 1, 'one cross-project link');
const link = mp.links[0];
assert.equal(link.from.programmeName, 'Tower A', 'link source = predecessor programme');
assert.equal(link.to.programmeName, 'Carpark B', 'link target = successor programme');
assert.equal(link.breached, true, 'successor starts before predecessor finishes → breached');
assert.ok(link.slackDays <= 0, 'breached link has non-positive slack');
assert.equal(mp.breaches, 1, 'breach counted');

console.log('portfolio.test.mjs — all assertions passed');
