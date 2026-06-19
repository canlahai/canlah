import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Local-JSON store in a throwaway dir BEFORE import.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
process.env.DEV_PROGRAMMES_DIR = mkdtempSync(join(tmpdir(), 'canlah-portfolio-'));

const { createProgramme, updateProgramme } = await import('../../lib/programmes.js');
const { lookahead, resourceLoad, masterPlan, reflow, attention } = await import('../../lib/portfolio.js');

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

// --- auto re-flow (propose + apply clears the breach) -----------------------
const rf = await reflow(USER);
assert.equal(rf.hasCycle, false, 'no dependency cycle');
const prop = rf.proposals.find((p) => p.programmeName === 'Carpark B');
assert.ok(prop, 're-flow proposes a new start for the breached successor');
assert.ok(prop.proposedStart > prop.currentStart, 'proposed start is later than current');
assert.ok(prop.shiftWorkingDays > 0, 're-flow shift is a positive number of working days');
assert.ok(!rf.proposals.some((p) => p.programmeName === 'Tower A'), 'the predecessor (no incoming deps) is not shifted');

// Apply the proposal → the breach is gone and nothing more is proposed.
assert.equal((await updateProgramme(B.id, USER, { startDate: prop.proposedStart })).ok, true, 'apply re-flow start date');
const mp2 = await masterPlan(USER);
assert.equal(mp2.breaches, 0, 'breach cleared after applying re-flow');
const rf2 = await reflow(USER);
assert.equal(rf2.proposals.length, 0, 'no further proposals once dependencies are satisfied');

// --- attention inbox --------------------------------------------------------
const UATT = 'u-attn';
const past = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
await createProgramme({
  name: 'Attn P', ownerId: UATT, startDate: today,
  activities: [
    { id: 'c1', name: 'Blocked thing', durationDays: 3, predecessors: [], status: 'blocked', blockedReason: 'rebar late', assignee: 'PM' },
    { id: 'c2', name: 'Pour', durationDays: 2, predecessors: [], status: 'todo', deliveries: [{ item: 'Concrete', neededBy: past(2), status: 'needed' }] },
  ],
});
const att = await attention(UATT);
assert.equal(att.blocked.length, 1, 'one blocked activity');
assert.equal(att.blocked[0].name, 'Blocked thing', 'blocked item carries name');
assert.equal(att.blocked[0].reason, 'rebar late', 'blocked item carries reason');
assert.equal(att.lateDeliveries.length, 1, 'one late delivery flagged');
assert.equal(att.lateDeliveries[0].item, 'Concrete', 'late delivery carries item');
assert.ok(att.total >= 2, 'total counts attention items');
assert.ok(!att.blocked.some((b) => att.overdue.includes(b)), 'blocked not double-counted as overdue');

console.log('portfolio.test.mjs — all assertions passed');
