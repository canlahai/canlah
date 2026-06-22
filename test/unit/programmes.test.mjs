import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Force the local-JSON store (no Supabase) into a throwaway dir BEFORE import.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
process.env.DEV_PROGRAMMES_DIR = mkdtempSync(join(tmpdir(), 'canlah-prog-'));

const {
  ROLES, canEdit, canManage,
  listProgrammesForUser, listPortfolioForUser, getProgramme, createProgramme,
  updateProgramme, updateActivity, setMember, removeMember, deleteProgramme,
} = await import('../../lib/programmes.js');

const OWNER = 'u-owner';
const ENGINEER = 'u-eng';
const VIEWER = 'u-view';
const STRANGER = 'u-stranger';

// --- access-level helpers ---------------------------------------------------
assert.deepEqual(ROLES, ['admin', 'editor', 'viewer'], 'access levels');
assert.equal(canEdit('editor'), true, 'editor can edit');
assert.equal(canEdit('admin'), true, 'admin can edit');
assert.equal(canEdit('viewer'), false, 'viewer cannot edit');
assert.equal(canManage('admin'), true, 'admin can manage members');
assert.equal(canManage('editor'), false, 'editor cannot manage members');

// --- create validation ------------------------------------------------------
await assert.rejects(() => createProgramme({ ownerId: OWNER, startDate: '2026-07-01' }), /name required/, 'name required');
await assert.rejects(() => createProgramme({ name: 'X', startDate: '2026-07-01' }), /ownerId required/, 'ownerId required');
await assert.rejects(() => createProgramme({ name: 'X', ownerId: OWNER, startDate: 'July' }), /YYYY-MM-DD/, 'startDate format enforced');
await assert.rejects(() => createProgramme({ name: 'X', ownerId: OWNER, startDate: '2026-07-01', endDate: 'soon' }), /endDate must be YYYY-MM-DD/, 'bad endDate rejected');
await assert.rejects(() => createProgramme({ name: 'X', ownerId: OWNER, startDate: '2026-07-01', endDate: '2026-06-01' }), /on or after/, 'endDate before start rejected');

// --- optional target end date (separate owner so list counts below stay clean) ---
const DOWNER = 'u-dated-owner';
const withEnd = await createProgramme({ name: 'Dated', ownerId: DOWNER, startDate: '2026-07-01', endDate: '2026-12-31' });
assert.equal(withEnd.endDate, '2026-12-31', 'endDate stored + returned');
assert.equal((await createProgramme({ name: 'NoEnd', ownerId: DOWNER, startDate: '2026-07-01' })).endDate, null, 'endDate optional → null');
assert.equal((await updateProgramme(withEnd.id, DOWNER, { endDate: '2027-03-31' })).ok, true, 'endDate update ok');
assert.equal((await getProgramme(withEnd.id, DOWNER)).endDate, '2027-03-31', 'endDate update persisted');
assert.equal((await updateProgramme(withEnd.id, DOWNER, { endDate: 'nope' })).reason, 'invalid', 'bad endDate update rejected');
assert.equal((await updateProgramme(withEnd.id, DOWNER, { endDate: '' })).ok, true, 'endDate can be cleared');
assert.equal((await getProgramme(withEnd.id, DOWNER)).endDate, null, 'cleared endDate → null');

// --- create + read ----------------------------------------------------------
const activities = [
  { id: 'a1', name: 'Piling', trade: 'Substructure', durationDays: 10, predecessors: [] },
  { id: 'a2', name: 'Pile cap', trade: 'Substructure', durationDays: 5, predecessors: [{ id: 'a1' }] },
];
const created = await createProgramme({ name: 'Tower A', ownerId: OWNER, startDate: '2026-07-01', activities });
assert.equal(created.access, 'admin', 'owner is admin');
assert.equal(created.role, 'admin', 'role alias mirrors access');
assert.equal(created.ownerId, OWNER);
assert.equal(created.activities.length, 2);

const fetched = await getProgramme(created.id, OWNER);
assert.equal(fetched.name, 'Tower A', 'owner can read');
assert.equal(fetched.activities.length, 2, 'activities round-trip');
assert.ok(Array.isArray(fetched.members), 'members array present');

// --- access control: stranger sees nothing ----------------------------------
assert.equal(await getProgramme(created.id, STRANGER), null, 'stranger cannot read');
assert.equal((await listProgrammesForUser(STRANGER)).length, 0, 'stranger lists nothing');

// --- list shape -------------------------------------------------------------
const ownerList = await listProgrammesForUser(OWNER);
assert.equal(ownerList.length, 1, 'owner lists their programme');
assert.equal(ownerList[0].activityCount, 2, 'list carries activityCount, not full activities');
assert.equal('activities' in ownerList[0], false, 'list omits the activities payload');

// --- members: admin adds, validates access level + trade role ---------------
assert.equal((await setMember(created.id, OWNER, { userId: ENGINEER, accessLevel: 'platinum' })).reason, 'invalid', 'bad access level rejected');
assert.equal((await setMember(created.id, OWNER, { userId: ENGINEER, accessLevel: 'editor', tradeRole: 'banana' })).reason, 'invalid', 'bad trade role rejected');
assert.equal((await setMember(created.id, OWNER, { userId: ENGINEER, accessLevel: 'editor', tradeRole: 'engineer' })).ok, true, 'admin adds editor (engineer)');
assert.equal((await setMember(created.id, OWNER, { userId: VIEWER, accessLevel: 'viewer' })).ok, true, 'admin adds viewer');

const asEng = await getProgramme(created.id, ENGINEER);
assert.equal(asEng.access, 'editor', 'editor sees their access level');
const engMember = asEng.members.find((m) => m.userId === ENGINEER);
assert.equal(engMember.accessLevel, 'editor', 'member carries access level');
assert.equal(engMember.tradeRole, 'engineer', 'member carries trade role');
assert.equal((await listProgrammesForUser(ENGINEER)).length, 1, 'editor lists the shared programme');

// --- non-admin cannot add members -------------------------------------------
assert.equal((await setMember(created.id, ENGINEER, { userId: STRANGER, accessLevel: 'viewer' })).reason, 'forbidden', 'editor cannot manage members');

// --- edit permissions -------------------------------------------------------
assert.equal((await updateProgramme(created.id, ENGINEER, { name: 'Tower A (rev)' })).ok, true, 'editor can edit');
assert.equal((await getProgramme(created.id, OWNER)).name, 'Tower A (rev)', 'edit persisted');
assert.equal((await updateProgramme(created.id, VIEWER, { name: 'nope' })).reason, 'forbidden', 'viewer cannot edit');
assert.equal((await updateProgramme(created.id, STRANGER, { name: 'nope' })).reason, 'not_found', 'stranger edit -> not_found');

// --- update validation ------------------------------------------------------
assert.equal((await updateProgramme(created.id, OWNER, { startDate: 'soon' })).reason, 'invalid', 'bad startDate rejected');
assert.equal((await updateProgramme(created.id, OWNER, { activities: 'x' })).reason, 'invalid', 'activities must be array');
assert.equal((await updateProgramme(created.id, OWNER, { activities: [{ id: 'a1', durationDays: 12 }] })).ok, true, 'activities update ok');

// --- collaborative per-activity updates -------------------------------------
// Editor (engineer) updates one activity's status + checklist + parties + note.
const upd = await updateActivity(created.id, ENGINEER, 'a1', {
  status: 'blocked',
  blockedReason: 'concrete delivery delayed',
  responsibleParty: 'Procurement',
  parties: [{ role: 'procurement', who: 'Raj', responsibility: 'concrete delivery' }],
  checklist: [
    { id: 'c1', item: 'Formwork inspection', status: 'complied' },
    { id: 'c2', item: 'Rebar inspection', status: 'not_complied' },
  ],
}, 'Concrete pour pushed — waiting on supplier');
assert.equal(upd.ok, true, 'engineer can update an activity');

const after = await getProgramme(created.id, OWNER);
const a1 = after.activities.find((a) => a.id === 'a1');
assert.equal(a1.status, 'blocked', 'status persisted');
assert.equal(a1.responsibleParty, 'Procurement', 'responsible party persisted');
assert.equal(a1.checklist.length, 2, 'checklist persisted');
assert.equal(a1.parties[0].who, 'Raj', 'parties persisted');
assert.equal(a1.updates.length, 1, 'update log entry appended');
assert.equal(a1.updates[0].by, ENGINEER, 'update attributed to actor');
assert.equal(a1.updates[0].role, 'editor', "update carries actor's access level");
assert.equal(a1.updates[0].status, 'blocked', 'update records the status change');
assert.match(a1.updates[0].note, /supplier/, 'update note recorded');

// A second contributor appends to the same activity's log (collaboration).
await updateActivity(created.id, OWNER, 'a1', { status: 'in_progress' }, 'Supplier confirmed for Friday');
const after2 = (await getProgramme(created.id, OWNER)).activities.find((a) => a.id === 'a1');
assert.equal(after2.updates.length, 2, 'second update appended, not overwritten');
assert.equal(after2.status, 'in_progress', 'latest status wins');

// Permissions + validation.
assert.equal((await updateActivity(created.id, VIEWER, 'a1', { status: 'done' })).reason, 'forbidden', 'viewer cannot update activities');
assert.equal((await updateActivity(created.id, STRANGER, 'a1', { status: 'done' })).reason, 'not_found', 'stranger -> not_found');
assert.equal((await updateActivity(created.id, OWNER, 'ghost', { status: 'done' })).reason, 'invalid', 'unknown activity -> invalid');
assert.equal((await updateActivity(created.id, OWNER, 'a1', { status: 'banana' })).reason, 'invalid', 'bad status rejected');
assert.equal((await updateActivity(created.id, OWNER, 'a1', { checklist: 'x' })).reason, 'invalid', 'checklist must be array');
// field-update fields: progress (0–100) + photos (array)
assert.equal((await updateActivity(created.id, OWNER, 'a1', { progress: 150 })).reason, 'invalid', 'progress > 100 rejected');
assert.equal((await updateActivity(created.id, OWNER, 'a1', { photos: 'x' })).reason, 'invalid', 'photos must be array');
assert.equal((await updateActivity(created.id, OWNER, 'a1', { progress: 60, photos: [{ url: 'https://x/p.jpg', by: 'Sub' }] })).ok, true, 'progress + photo update ok');
assert.equal((await getProgramme(created.id, OWNER)).activities.find((a) => a.id === 'a1').progress, 60, 'progress persisted');
assert.equal((await getProgramme(created.id, OWNER)).activities.find((a) => a.id === 'a1').photos.length, 1, 'photo persisted');

// baseline snapshot persists on the programme
assert.equal((await updateProgramme(created.id, OWNER, { baseline: { savedAt: 'now', projectEnd: '2026-09-01', tasks: { a1: { end: '2026-08-01', durationDays: 5 } } } })).ok, true, 'baseline saved');
assert.equal((await getProgramme(created.id, OWNER)).baseline.projectEnd, '2026-09-01', 'baseline persisted + returned');

// --- remove member; cannot remove owner -------------------------------------
assert.equal((await removeMember(created.id, OWNER, OWNER)).reason, 'invalid', 'cannot remove the owner');
assert.equal((await removeMember(created.id, OWNER, VIEWER)).ok, true, 'pm removes viewer');
assert.equal(await getProgramme(created.id, VIEWER), null, 'removed viewer loses access');

// --- portfolio roll-up stats ------------------------------------------------
const PF = 'u-portfolio';
const pfActs = [
  { id: 'a1', name: 'Foundations', durationDays: 10, predecessors: [], status: 'done' },
  { id: 'a2', name: 'Columns L1', durationDays: 8, predecessors: [{ id: 'a1' }], status: 'in_progress' },
  // blocked → counts toward at-risk; not done
  { id: 'a3', name: 'Slab L1', durationDays: 6, predecessors: [{ id: 'a2' }], status: 'blocked' },
  // not_complied checklist → not ready → at-risk even though not blocked
  { id: 'a4', name: 'M&E rough-in', durationDays: 5, predecessors: [{ id: 'a3' }], status: 'todo',
    checklist: [{ item: 'permit', status: 'not_complied' }] },
];
const pf = await createProgramme({ name: 'Portfolio P', ownerId: PF, startDate: '2026-07-01', endDate: '2026-07-10', activities: pfActs });
const portfolio = await listPortfolioForUser(PF);
assert.equal(portfolio.length, 1, 'portfolio lists owned programme');
const ps = portfolio[0].stats;
assert.ok(ps, 'portfolio entry carries stats');
assert.equal('activities' in portfolio[0], false, 'portfolio omits raw activities');
assert.equal(ps.total, 4, 'stats: total activities');
assert.equal(ps.done, 1, 'stats: done count');
assert.equal(ps.blocked, 1, 'stats: blocked count');
assert.equal(ps.atRisk, 2, 'stats: blocked + not-ready are at risk');
assert.equal(ps.percentComplete, 25, 'stats: percent complete = done/total');
assert.ok(ps.computedEnd && ps.computedEnd > '2026-07-10', 'stats: computed end past the tight target');
assert.equal(ps.targetEnd, '2026-07-10', 'stats: target end echoed');
assert.ok(ps.overrunDays > 0, 'stats: positive overrun vs target');
await deleteProgramme(pf.id, PF);

// --- delete: owner only -----------------------------------------------------
assert.equal((await deleteProgramme(created.id, ENGINEER)).reason, 'forbidden', 'non-owner cannot delete');
assert.equal((await deleteProgramme(created.id, OWNER)).ok, true, 'owner deletes');
assert.equal(await getProgramme(created.id, OWNER), null, 'deleted programme is gone');
assert.equal((await deleteProgramme('missing', OWNER)).reason, 'not_found', 'deleting unknown -> not_found');

console.log('programmes.test.mjs — all assertions passed');
