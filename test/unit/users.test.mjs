import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Force the local-JSON store (no Supabase) into a throwaway dir BEFORE import.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
process.env.DEV_USERS_DIR = mkdtempSync(join(tmpdir(), 'canlah-users-'));

const {
  hashPassword, verifyPassword,
  createUser, verifyCredentials, listUsers, setUserDisabled, usersAuthEnabled,
} = await import('../../lib/users.js');

// --- password hashing -------------------------------------------------------
const h = hashPassword('correct horse battery staple');
assert.match(h, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/, 'hash format scrypt$salt$hash');
assert.equal(verifyPassword('correct horse battery staple', h), true, 'correct password verifies');
assert.equal(verifyPassword('wrong', h), false, 'wrong password rejected');
assert.equal(verifyPassword('correct horse battery staple', 'garbage'), false, 'malformed hash rejected');
assert.equal(verifyPassword('x', ''), false, 'empty stored rejected');
assert.notEqual(hashPassword('same'), hashPassword('same'), 'unique salt per hash');

// --- createUser validation --------------------------------------------------
await assert.rejects(() => createUser({ email: 'nope', password: 'longenough' }), /valid email/, 'bad email rejected');
await assert.rejects(() => createUser({ email: 'a@b.co', password: 'short' }), /at least 8/, 'short password rejected');
await assert.rejects(() => createUser({ email: 'a@b.co', password: 'longenough', role: 'superadmin' }), /role/, 'bad role rejected');

// --- create + verify --------------------------------------------------------
const created = await createUser({ email: 'Alice@Example.com ', password: 'password123', name: 'Alice', role: 'admin' });
assert.equal(created.email, 'alice@example.com', 'email normalized lower/trim');
assert.equal(created.role, 'admin', 'role stored');
assert.equal('password_hash' in created, false, 'returned user has no password_hash');

const ok = await verifyCredentials('alice@example.com', 'password123');
assert.ok(ok && ok.id === created.id, 'correct credentials verify');
assert.equal(await verifyCredentials('alice@example.com', 'wrongpw'), null, 'wrong password -> null');
assert.equal(await verifyCredentials('ALICE@example.com', 'password123') !== null, true, 'email match is case-insensitive');
assert.equal(await verifyCredentials('ghost@example.com', 'whatever'), null, 'unknown email -> null');

// --- duplicate email --------------------------------------------------------
await assert.rejects(() => createUser({ email: 'alice@example.com', password: 'password123' }), /already registered/, 'duplicate email rejected');

// --- disable ----------------------------------------------------------------
await createUser({ email: 'bob@example.com', password: 'password123', name: 'Bob' });
assert.ok(await verifyCredentials('bob@example.com', 'password123'), 'bob can log in');
assert.equal(await setUserDisabled((await listUsers()).find((u) => u.email === 'bob@example.com').id, true), true, 'disable returns true');
assert.equal(await verifyCredentials('bob@example.com', 'password123'), null, 'disabled user cannot log in');

// --- listUsers --------------------------------------------------------------
const all = await listUsers();
assert.equal(all.length, 2, 'two users listed');
assert.ok(all.every((u) => !('password_hash' in u)), 'list never leaks hashes');

// --- usersAuthEnabled -------------------------------------------------------
delete process.env.AUTH_MODE;
assert.equal(usersAuthEnabled(), false, 'default not users-mode');
process.env.AUTH_MODE = 'users';
assert.equal(usersAuthEnabled(), true, 'AUTH_MODE=users enables');
delete process.env.AUTH_MODE;

console.log('users.test.mjs — all assertions passed');
