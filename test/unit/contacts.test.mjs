import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Force the local-JSON store into a throwaway dir BEFORE import.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
process.env.DEV_PROGRAMMES_DIR = mkdtempSync(join(tmpdir(), 'canlah-contacts-'));

const { listContacts, addContact, updateContact, removeContact } = await import('../../lib/contacts.js');

const OWNER = 'u-main';
const OTHER = 'u-other';

// --- validation -------------------------------------------------------------
assert.equal((await addContact(OWNER, { email: 'nope' })).reason, 'invalid', 'bad email rejected');
assert.equal((await addContact(OWNER, { email: 'a@b.sg', tradeRole: 'banana' })).reason, 'invalid', 'bad trade rejected');

// --- add + list -------------------------------------------------------------
const c1 = await addContact(OWNER, { email: 'Sub@Firm.SG', name: 'Ah Seng', company: 'Colour Low', tradeRole: 'subcon' });
assert.equal(c1.ok, true, 'add ok');
assert.equal(c1.contact.email, 'sub@firm.sg', 'email normalised lowercase');
const list = await listContacts(OWNER);
assert.equal(list.length, 1, 'owner lists their contact');
assert.equal(list[0].company, 'Colour Low', 'company stored');

// --- upsert by owner+email (no duplicate) -----------------------------------
const c2 = await addContact(OWNER, { email: 'sub@firm.sg', company: 'Colour Low Pte Ltd' });
assert.equal(c2.ok, true, 'upsert ok');
const list2 = await listContacts(OWNER);
assert.equal(list2.length, 1, 'upsert did not duplicate');
assert.equal(list2[0].company, 'Colour Low Pte Ltd', 'company updated on upsert');
assert.equal(list2[0].name, 'Ah Seng', 'name preserved on partial upsert');

// --- owner isolation --------------------------------------------------------
await addContact(OTHER, { email: 'x@y.sg', name: 'Stranger' });
assert.equal((await listContacts(OWNER)).length, 1, "owner cannot see other owner's contacts");
assert.equal((await listContacts(OTHER)).length, 1, 'other owner has their own');

// --- update + remove --------------------------------------------------------
assert.equal((await updateContact(OWNER, list2[0].id, { tradeRole: 'engineer' })).ok, true, 'update ok');
assert.equal((await listContacts(OWNER))[0].tradeRole, 'engineer', 'update persisted');
assert.equal((await updateContact(OWNER, 'ghost', { name: 'x' })).reason, 'not_found', 'update unknown -> not_found');
assert.equal((await removeContact(OWNER, list2[0].id)).ok, true, 'remove ok');
assert.equal((await listContacts(OWNER)).length, 0, 'removed');
assert.equal((await removeContact(OWNER, 'ghost')).reason, 'not_found', 'remove unknown -> not_found');

console.log('contacts.test.mjs — all assertions passed');
