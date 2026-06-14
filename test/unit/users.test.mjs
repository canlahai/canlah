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
  getUserById, setUserTier, consumeRead, hasProAccess,
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

// --- tier defaults ----------------------------------------------------------
const carol = await createUser({ email: 'carol@example.com', password: 'password123', name: 'Carol' });
assert.equal(carol.tier, 'free', 'new user defaults to free tier');
assert.equal(carol.readsThisMonth, 0, 'new user starts at 0 reads');

// --- getUserById ------------------------------------------------------------
assert.equal((await getUserById(carol.id)).email, 'carol@example.com', 'getUserById returns the user');
assert.equal(await getUserById('does-not-exist'), null, 'unknown id -> null');

// --- setUserTier ------------------------------------------------------------
await assert.rejects(() => setUserTier(carol.id, 'platinum'), /free.*pro|tier must/, 'invalid tier rejected');
assert.equal(await setUserTier('ghost-id', 'pro'), false, 'unknown id -> false');
assert.equal(await setUserTier(carol.id, 'pro'), true, 'set tier returns true');
assert.equal((await getUserById(carol.id)).tier, 'pro', 'tier persisted as pro');
await setUserTier(carol.id, 'free'); // reset for quota test

// --- consumeRead: free-tier quota -------------------------------------------
const q1 = await consumeRead(carol.id, { limit: 2 });
assert.deepEqual(q1, { ok: true, remaining: 1 }, 'first read ok, 1 remaining');
const q2 = await consumeRead(carol.id, { limit: 2 });
assert.deepEqual(q2, { ok: true, remaining: 0 }, 'second read ok, 0 remaining');
const q3 = await consumeRead(carol.id, { limit: 2 });
assert.equal(q3.ok, false, 'third read blocked');
assert.equal(q3.reason, 'limit', 'blocked reason is limit');
assert.equal((await getUserById(carol.id)).readsThisMonth, 2, 'counter capped at limit');

// --- consumeRead: pro + admin are unlimited ---------------------------------
await setUserTier(carol.id, 'pro');
const qpro = await consumeRead(carol.id, { limit: 2 });
assert.deepEqual(qpro, { ok: true, unlimited: true }, 'pro is unlimited');
const adminUser = (await listUsers()).find((u) => u.role === 'admin');
const qadmin = await consumeRead(adminUser.id, { limit: 0 });
assert.deepEqual(qadmin, { ok: true, unlimited: true }, 'admin is unlimited even at limit 0');

// --- consumeRead: monthly reset ---------------------------------------------
await setUserTier(carol.id, 'free');
// Force the stored period into the past, then a read should reset the counter.
process.env.DEV_USERS_DIR && (await (async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const f = join(process.env.DEV_USERS_DIR, 'users.json');
  const users = JSON.parse(readFileSync(f, 'utf8'));
  const c = users.find((u) => u.id === carol.id);
  c.reads_this_month = 99; c.reads_period = '2000-01';
  writeFileSync(f, JSON.stringify(users, null, 2));
})());
const qreset = await consumeRead(carol.id, { limit: 5 });
assert.deepEqual(qreset, { ok: true, remaining: 4 }, 'stale period resets counter to 0 then +1');

// --- consumeRead: unknown user ----------------------------------------------
assert.deepEqual(await consumeRead('nobody', { limit: 5 }), { ok: false, reason: 'not_found' }, 'unknown user not_found');

// --- hasProAccess -----------------------------------------------------------
assert.equal(await hasProAccess({ ok: false }), false, 'no access when not ok');
assert.equal(await hasProAccess({ ok: true, demo: true }), true, 'demo mode is open');
delete process.env.AUTH_MODE; // shared mode
assert.equal(await hasProAccess({ ok: true, id: carol.id }), true, 'shared mode is open');
process.env.AUTH_MODE = 'users';
assert.equal(await hasProAccess({ ok: true, role: 'admin', id: 'x' }), true, 'admin always pro');
await setUserTier(carol.id, 'free');
assert.equal(await hasProAccess({ ok: true, id: carol.id }), false, 'free user is not pro');
await setUserTier(carol.id, 'pro');
assert.equal(await hasProAccess({ ok: true, id: carol.id }), true, 'pro user passes');
delete process.env.AUTH_MODE;

// --- usersAuthEnabled -------------------------------------------------------
delete process.env.AUTH_MODE;
assert.equal(usersAuthEnabled(), false, 'default not users-mode');
process.env.AUTH_MODE = 'users';
assert.equal(usersAuthEnabled(), true, 'AUTH_MODE=users enables');
delete process.env.AUTH_MODE;

console.log('users.test.mjs — all assertions passed');
