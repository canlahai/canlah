import assert from 'node:assert/strict';
import { checkRateLimit, clientIp, enforceRateLimit, _resetRateLimitForTests } from '../../lib/rate-limit.js';

_resetRateLimitForTests();

// --- checkRateLimit: under / at / over the limit ---------------------------
const t0 = 1_000_000;
for (let i = 1; i <= 3; i++) {
  const r = checkRateLimit('k', { limit: 3, windowMs: 60_000, now: t0 });
  assert.equal(r.ok, true, `hit ${i} within limit`);
  assert.equal(r.remaining, 3 - i, `remaining after hit ${i}`);
}
const over = checkRateLimit('k', { limit: 3, windowMs: 60_000, now: t0 });
assert.equal(over.ok, false, '4th hit over the limit');
assert.equal(over.remaining, 0, 'no remaining when over');
assert.ok(over.retryAfter > 0, 'retryAfter set when blocked');

// --- window expiry frees the budget ----------------------------------------
const later = checkRateLimit('k', { limit: 3, windowMs: 60_000, now: t0 + 61_000 });
assert.equal(later.ok, true, 'old hits drop out of the window');

// --- per-key isolation ------------------------------------------------------
_resetRateLimitForTests();
checkRateLimit('a', { limit: 1, now: t0 });
const aBlocked = checkRateLimit('a', { limit: 1, now: t0 });
const bOk = checkRateLimit('b', { limit: 1, now: t0 });
assert.equal(aBlocked.ok, false, 'key a exhausted');
assert.equal(bOk.ok, true, 'key b independent of a');

// --- clientIp ---------------------------------------------------------------
assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }), '1.2.3.4', 'first XFF hop');
assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '9.9.9.9' } }), '9.9.9.9', 'socket fallback');
assert.equal(clientIp({ headers: {} }), 'unknown', 'unknown when nothing available');

// --- enforceRateLimit writes 429 -------------------------------------------
_resetRateLimitForTests();
function mockRes() {
  return {
    _status: 200, _json: null, _headers: {},
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
}
// enforceRateLimit is async (durable backend does I/O); default env uses in-memory.
const req = { headers: { 'x-forwarded-for': '1.1.1.1' } };
let res = mockRes();
assert.equal(await enforceRateLimit(req, res, { id: 'x', limit: 1 }), true, 'first call allowed');
res = mockRes();
assert.equal(await enforceRateLimit(req, res, { id: 'x', limit: 1 }), false, 'second call blocked');
assert.equal(res._status, 429, 'writes 429');
assert.ok(res._headers['Retry-After'], 'sets Retry-After header');

// different route id is a separate bucket
res = mockRes();
assert.equal(await enforceRateLimit(req, res, { id: 'y', limit: 1 }), true, 'separate route id has own budget');

_resetRateLimitForTests();
console.log('rate-limit.test.mjs — all assertions passed');
