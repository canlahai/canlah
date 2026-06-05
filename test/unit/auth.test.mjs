import assert from 'node:assert/strict';

// Configure a non-demo, signed-session environment BEFORE importing the module.
// getSecret/isDemoMode read env live on each call, so later mutations still apply.
process.env.SESSION_SECRET = 'unit-test-secret';
process.env.DEMO_MODE = 'false';
process.env.BLOB_READ_WRITE_TOKEN = 'fake-token'; // makes isDemoMode() false
delete process.env.ADMIN_API_KEY;

const {
  sign, verify, parseCookies, getSession,
  setSessionCookie, clearSessionCookie, authCheck, requireAuth, SESSION_COOKIE_NAME,
} = await import('../../lib/auth.js');

// --- sign / verify round trip ----------------------------------------------
const payload = { role: 'user', id: 'u1', exp: Date.now() + 100000 };
const token = sign(payload);
assert.deepEqual(verify(token), payload, 'sign/verify round-trips');

// --- tamper resistance ------------------------------------------------------
const [b64, sig] = token.split('.');
const forgedB64 = Buffer.from(JSON.stringify({ role: 'admin', id: 'evil' })).toString('base64url');
assert.equal(verify(`${forgedB64}.${sig}`), null, 'tampered payload rejected (sig mismatch)');
assert.equal(verify(`${b64}.${sig}TAMPER`), null, 'tampered signature rejected');
assert.equal(verify(`${b64}.`), null, 'missing signature rejected');
assert.equal(verify(b64), null, 'token with no separator rejected');
assert.equal(verify(''), null, 'empty token rejected');
assert.equal(verify(null), null, 'null token rejected');
assert.equal(verify(12345), null, 'non-string token rejected');
assert.equal(verify('garbage.garbage'), null, 'garbage token rejected');

// --- expiry -----------------------------------------------------------------
assert.equal(verify(sign({ role: 'user', id: 'u', exp: Date.now() - 1000 })), null, 'expired token rejected');
assert.ok(verify(sign({ role: 'user', id: 'u', exp: Date.now() + 60000 })), 'unexpired token accepted');

// --- forgery with a different secret ---------------------------------------
process.env.SESSION_SECRET = 'attacker-secret';
const forged = sign({ role: 'admin', id: 'evil', exp: Date.now() + 100000 });
process.env.SESSION_SECRET = 'unit-test-secret';
assert.equal(verify(forged), null, 'token signed with a different secret is rejected');

// --- parseCookies -----------------------------------------------------------
assert.deepEqual(parseCookies(''), {}, 'empty cookie header -> {}');
assert.deepEqual(parseCookies(undefined), {}, 'undefined cookie header -> {}');
assert.deepEqual(parseCookies('a=1; b=2'), { a: '1', b: '2' }, 'multiple cookies parsed');
assert.deepEqual(parseCookies('x=hello%20world'), { x: 'hello world' }, 'cookie value url-decoded');

// --- getSession -------------------------------------------------------------
const req = { headers: { cookie: `${SESSION_COOKIE_NAME}=${sign(payload)}` } };
assert.deepEqual(getSession(req), payload, 'getSession reads + verifies the cookie');
assert.equal(getSession({ headers: {} }), null, 'no cookie -> null session');
assert.equal(getSession({ headers: { cookie: `${SESSION_COOKIE_NAME}=bad.token` } }), null, 'bad cookie -> null');

// --- cookie formatting ------------------------------------------------------
const cookie = setSessionCookie(payload);
assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=`), 'cookie uses session name');
assert.match(cookie, /HttpOnly/, 'HttpOnly set');
assert.match(cookie, /SameSite=Lax/, 'SameSite=Lax set');
assert.match(cookie, /Max-Age=604800/, '7-day max-age');
assert.ok(!/Secure/.test(cookie), 'no Secure flag outside production');

process.env.NODE_ENV = 'production';
assert.match(setSessionCookie(payload), /;\s*Secure/, 'Secure flag added in production');
delete process.env.NODE_ENV;

assert.match(clearSessionCookie(), /Max-Age=0/, 'clearSessionCookie expires the cookie');

// --- authCheck --------------------------------------------------------------
assert.deepEqual(authCheck(req), { ok: true, role: 'user' }, 'authCheck accepts a valid session');
assert.deepEqual(authCheck({ headers: {} }), { ok: false }, 'authCheck rejects when no auth');

process.env.ADMIN_API_KEY = 'admin-secret';
assert.deepEqual(authCheck({ headers: { 'x-api-key': 'admin-secret' } }), { ok: true, role: 'admin' }, 'admin API key accepted');
assert.deepEqual(authCheck({ headers: { 'x-api-key': 'nope' } }), { ok: false }, 'wrong admin key rejected');
delete process.env.ADMIN_API_KEY;

// demo mode bypasses auth entirely
process.env.DEMO_MODE = 'true';
assert.deepEqual(authCheck({ headers: {} }), { ok: true, demo: true }, 'demo mode bypasses auth');
process.env.DEMO_MODE = 'false';

// --- requireAuth writes the 401 -------------------------------------------
let status = null, body = null;
const res = { status(c) { status = c; return this; }, json(o) { body = o; return this; } };
const result = requireAuth({ headers: {} }, res);
assert.equal(result.ok, false, 'requireAuth returns the failed result');
assert.equal(status, 401, 'requireAuth writes 401');
assert.ok(body && body.error, 'requireAuth writes an error body');

console.log('auth.test.mjs — all assertions passed');
