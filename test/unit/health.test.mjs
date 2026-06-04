import assert from 'node:assert/strict';
import { pingSupabase, _resetSupabaseClientForTests } from '../../lib/supabase.js';
import health from '../../api/health.js';

// Mock res that records status + json, like Vercel's res.
function mockRes() {
  return {
    _status: 200,
    _json: null,
    status(c) { this._status = c; return this; },
    json(o) { this._json = o; return this; },
    setHeader() {},
  };
}
const get = (url) => ({ method: 'GET', url });

function clearSupabaseEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  _resetSupabaseClientForTests();
}

// --- pingSupabase: not configured -----------------------------------------
clearSupabaseEnv();
let ping = await pingSupabase();
assert.deepEqual(ping, { configured: false, reachable: false }, 'unconfigured -> not configured, not reachable');

// --- pingSupabase: configured but unreachable (the prod outage scenario) ----
// .invalid is a reserved TLD that never resolves, so this fails fast without
// touching a real backend — exactly the deleted/paused-project failure mode.
process.env.SUPABASE_URL = 'https://nonexistent-canlah-test.invalid';
process.env.SUPABASE_SERVICE_KEY = 'test-key';
_resetSupabaseClientForTests();
ping = await pingSupabase({ timeoutMs: 6000 });
assert.equal(ping.configured, true, 'env present -> configured');
assert.equal(ping.reachable, false, 'dead backend -> not reachable');
assert.ok(ping.error, 'unreachable result carries an error message');
assert.equal(typeof ping.latencyMs, 'number', 'latency measured');

// --- health handler: shallow check is always ok ----------------------------
clearSupabaseEnv();
let res = mockRes();
await health(get('/api/health'), res);
assert.equal(res._status, 200, 'shallow health -> 200');
assert.equal(res._json.status, 'ok', 'shallow health status ok');
assert.equal('reachable' in res._json.supabase, false, 'shallow check does NOT probe reachability');

// --- health handler: deep check, not configured -> ok (nothing to be down) --
res = mockRes();
await health(get('/api/health?deep=1'), res);
assert.equal(res._status, 200, 'deep + unconfigured -> 200 (not degraded)');
assert.equal(res._json.status, 'ok', 'unconfigured is not degraded');
assert.equal(res._json.supabase.reachable, false, 'deep check reports reachable:false');

// --- health handler: deep check, configured but dead -> 503 degraded --------
process.env.SUPABASE_URL = 'https://nonexistent-canlah-test.invalid';
process.env.SUPABASE_SERVICE_KEY = 'test-key';
_resetSupabaseClientForTests();
res = mockRes();
await health(get('/api/health?deep=1'), res);
assert.equal(res._status, 503, 'deep + dead backend -> 503');
assert.equal(res._json.status, 'degraded', 'reports degraded');
assert.equal(res._json.supabase.reachable, false, 'supabase reachable:false in body');

// --- method guard ----------------------------------------------------------
res = mockRes();
await health({ method: 'POST', url: '/api/health' }, res);
assert.equal(res._status, 405, 'non-GET -> 405');

clearSupabaseEnv();
console.log('health.test.mjs — all assertions passed');
