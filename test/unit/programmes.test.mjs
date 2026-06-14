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
  listProgrammesForUser, getProgramme, createProgramme,
  updateProgramme, setMember, removeMember, deleteProgramme,
} = await import('../../lib/programmes.js');

const OWNER = 'u-owner';
const ENGINEER = 'u-eng';
const VIEWER = 'u-view';
const STRANGER = 'u-stranger';

// --- role helpers -----------------------------------------------------------
assert.deepEqual(ROLES, ['pm', 'engineer', 'procurement', 'subcon', 'viewer']);
assert.equal(canEdit('engineer'), true, 'engineer can edit');
assert.equal(canEdit('viewer'), false, 'viewer cannot edit');
assert.equal(canManage('pm'), true, 'pm can manage members');
assert.equal(canManage('engineer'), false, 'engineer cannot manage members');

// --- create validation ------------------------------------------------------
await assert.rejects(() => createProgramme({ ownerId: OWNER, startDate: '2026-07-01' }), /name required/, 'name required');
await assert.rejects(() => createProgramme({ name: 'X', startDate: '2026-07-01' }), /ownerId required/, 'ownerId required');
await assert.rejects(() => createProgramme({ name: 'X', ownerId: OWNER, startDate: 'July' }), /YYYY-MM-DD/, 'startDate format enforced');

// --- create + read ----------------------------------------------------------
const activities = [
  { id: 'a1', name: 'Piling', trade: 'Substructure', durationDays: 10, predecessors: [] },
  { id: 'a2', name: 'Pile cap', trade: 'Substructure', durationDays: 5, predecessors: [{ id: 'a1' }] },
];
const created = await createProgramme({ name: 'Tower A', ownerId: OWNER, startDate: '2026-07-01', activities });
assert.equal(created.role, 'pm', 'owner is effective pm');
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

// --- members: pm adds, validates role ---------------------------------------
assert.equal((await setMember(created.id, OWNER, { userId: ENGINEER, role: 'platinum' })).reason, 'invalid', 'bad role rejected');
assert.equal((await setMember(created.id, OWNER, { userId: ENGINEER, role: 'engineer' })).ok, true, 'pm adds engineer');
assert.equal((await setMember(created.id, OWNER, { userId: VIEWER, role: 'viewer' })).ok, true, 'pm adds viewer');

const asEng = await getProgramme(created.id, ENGINEER);
assert.equal(asEng.role, 'engineer', 'engineer sees their role');
assert.equal((await listProgrammesForUser(ENGINEER)).length, 1, 'engineer lists the shared programme');

// --- non-manager cannot add members -----------------------------------------
assert.equal((await setMember(created.id, ENGINEER, { userId: STRANGER, role: 'viewer' })).reason, 'forbidden', 'engineer cannot manage members');

// --- edit permissions -------------------------------------------------------
assert.equal((await updateProgramme(created.id, ENGINEER, { name: 'Tower A (rev)' })).ok, true, 'engineer can edit');
assert.equal((await getProgramme(created.id, OWNER)).name, 'Tower A (rev)', 'edit persisted');
assert.equal((await updateProgramme(created.id, VIEWER, { name: 'nope' })).reason, 'forbidden', 'viewer cannot edit');
assert.equal((await updateProgramme(created.id, STRANGER, { name: 'nope' })).reason, 'not_found', 'stranger edit -> not_found');

// --- update validation ------------------------------------------------------
assert.equal((await updateProgramme(created.id, OWNER, { startDate: 'soon' })).reason, 'invalid', 'bad startDate rejected');
assert.equal((await updateProgramme(created.id, OWNER, { activities: 'x' })).reason, 'invalid', 'activities must be array');
assert.equal((await updateProgramme(created.id, OWNER, { activities: [{ id: 'a1', durationDays: 12 }] })).ok, true, 'activities update ok');

// --- remove member; cannot remove owner -------------------------------------
assert.equal((await removeMember(created.id, OWNER, OWNER)).reason, 'invalid', 'cannot remove the owner');
assert.equal((await removeMember(created.id, OWNER, VIEWER)).ok, true, 'pm removes viewer');
assert.equal(await getProgramme(created.id, VIEWER), null, 'removed viewer loses access');

// --- delete: owner only -----------------------------------------------------
assert.equal((await deleteProgramme(created.id, ENGINEER)).reason, 'forbidden', 'non-owner cannot delete');
assert.equal((await deleteProgramme(created.id, OWNER)).ok, true, 'owner deletes');
assert.equal(await getProgramme(created.id, OWNER), null, 'deleted programme is gone');
assert.equal((await deleteProgramme('missing', OWNER)).reason, 'not_found', 'deleting unknown -> not_found');

console.log('programmes.test.mjs — all assertions passed');
