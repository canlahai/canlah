import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
process.env.DEV_PROGRAMMES_DIR = mkdtempSync(join(tmpdir(), 'canlah-inv-'));
process.env.DEV_USERS_DIR = mkdtempSync(join(tmpdir(), 'canlah-inv-users-'));

const { createProgramme, getProgramme } = await import('../../lib/programmes.js');
const { createInvite, getInvite, listInvites, revokeInvite, acceptInvite } = await import('../../lib/invites.js');
const { createUser } = await import('../../lib/users.js');

const OWNER = 'u-owner';
const SUBCON = 'u-subcon';
const prog = await createProgramme({ name: 'Tower A', ownerId: OWNER, startDate: '2026-07-01' });

// --- create: permission + validation ----------------------------------------
assert.equal((await createInvite({ programmeId: prog.id, actorAccess: 'viewer', email: 'a@b.co', accessLevel: 'editor' })).reason, 'forbidden', 'non-admin cannot invite');
assert.equal((await createInvite({ programmeId: prog.id, actorAccess: 'admin', email: 'nope', accessLevel: 'editor' })).reason, 'invalid', 'bad email rejected');
assert.equal((await createInvite({ programmeId: prog.id, actorAccess: 'admin', email: 'a@b.co', accessLevel: 'king' })).reason, 'invalid', 'bad access level rejected');

const made = await createInvite({ programmeId: prog.id, actorAccess: 'admin', email: 'Subcon@Acme.SG', accessLevel: 'editor', tradeRole: 'subcon', invitedBy: OWNER });
assert.equal(made.ok, true, 'admin creates invite');
assert.ok(made.invite.token, 'invite has a token');
assert.equal(made.invite.email, 'subcon@acme.sg', 'email normalised');
assert.equal(made.invite.programmeName, 'Tower A', 'programme name snapshotted');
const token = made.invite.token;

// --- lookup + list ----------------------------------------------------------
assert.equal((await getInvite(token)).accessLevel, 'editor', 'getInvite returns the invite');
assert.equal((await listInvites(prog.id, 'viewer')).reason, 'forbidden', 'non-admin cannot list');
assert.equal((await listInvites(prog.id, 'admin')).invites.length, 1, 'one pending invite listed');

// --- accept: email must match ----------------------------------------------
assert.equal((await acceptInvite(token, { id: SUBCON, email: 'someone@else.com' })).reason, 'forbidden', 'wrong email cannot accept');
const acc = await acceptInvite(token, { id: SUBCON, email: 'subcon@acme.sg' });
assert.equal(acc.ok, true, 'matching email accepts');
assert.equal(acc.accessLevel, 'editor', 'returns granted access level');

// membership granted with the invite's access + trade role
const asSub = await getProgramme(prog.id, SUBCON);
assert.equal(asSub.access, 'editor', 'invitee now has editor access');
const sm = asSub.members.find((m) => m.userId === SUBCON);
assert.equal(sm.tradeRole, 'subcon', 'trade role applied from invite');

// --- accept is one-shot; no longer pending ----------------------------------
assert.equal((await acceptInvite(token, { id: SUBCON, email: 'subcon@acme.sg' })).reason, 'invalid', 'cannot re-accept');
assert.equal((await listInvites(prog.id, 'admin')).invites.length, 0, 'accepted invite no longer pending');

// --- revoke -----------------------------------------------------------------
const m2 = await createInvite({ programmeId: prog.id, actorAccess: 'admin', email: 'foreman@acme.sg', accessLevel: 'viewer' });
assert.equal((await listInvites(prog.id, 'admin')).invites.length, 1, 'new pending invite');
assert.equal((await revokeInvite(m2.invite.token, 'viewer')).reason, 'forbidden', 'non-admin cannot revoke');
assert.equal((await revokeInvite(m2.invite.token, 'admin')).ok, true, 'admin revokes');
assert.equal((await listInvites(prog.id, 'admin')).invites.length, 0, 'revoked invite gone from pending');

// --- self-onboard: a brand-new invitee creates their own account from the link --
const inv3 = await createInvite({ programmeId: prog.id, actorAccess: 'admin', email: 'NewSub@Acme.SG', accessLevel: 'editor', tradeRole: 'subcon', invitedBy: OWNER });
const invEmail = (await getInvite(inv3.invite.token)).email; // normalised to lowercase
const newUser = await createUser({ email: invEmail, password: 'supersecret', name: 'New Sub', role: 'user' });
const acc3 = await acceptInvite(inv3.invite.token, { id: newUser.id, email: newUser.email });
assert.equal(acc3.ok, true, 'self-onboarded user accepts their own invite');
const asNew = await getProgramme(prog.id, newUser.id);
assert.equal(asNew.access, 'editor', 'self-onboarded user gets the invited access level');
assert.equal(asNew.members.find((m) => m.userId === newUser.id).tradeRole, 'subcon', 'trade role applied on self-onboard');

console.log('invites.test.mjs — all assertions passed');
