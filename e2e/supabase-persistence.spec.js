import { test, expect } from '@playwright/test';

// Persistence integration against a REAL Supabase backend (a dedicated TEST
// project — never prod). Driven entirely through the API (login → save → list →
// search → get-by-id → delete), so there's no Anthropic/upload dependency and no
// UI flakiness. Runs only when SUPABASE_URL + SUPABASE_SERVICE_KEY are set and
// PLAYWRIGHT_SUPABASE_MODE=1 (testIgnore in playwright.config gates the file).
//
// Each test self-cleans the rows it creates; a best-effort afterAll sweeps any
// leftovers from a mid-test failure.

const SKIP = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY;
const PASSWORD = process.env.ACCESS_PASSWORD || 'ci-test-access-password';

test.describe('Supabase Persistence Integration', () => {
  test.skip(SKIP, 'requires SUPABASE_URL + SUPABASE_SERVICE_KEY (a dedicated test project)');
  test.describe.configure({ mode: 'serial' });
  const createdIds = [];

  async function login(request) {
    const res = await request.post('/api/login', { data: { password: PASSWORD } });
    expect(res.status(), 'login should succeed (ACCESS_PASSWORD set on the test server)').toBe(200);
  }

  async function saveReport(request, report) {
    const res = await request.post('/api/save-report', { data: { report } });
    const text = await res.text();
    expect(res.status(), `save-report failed (${res.status()}): ${text}`).toBe(200);
    const { id } = JSON.parse(text);
    createdIds.push(id);
    return id;
  }

  test('config: real Supabase, reachable, not demo mode', async ({ request }) => {
    const cfg = await (await request.get('/api/config')).json();
    expect(cfg.demoMode).toBe(false);
    expect(cfg.supabase?.configured).toBe(true);
    expect(cfg.supabase?.table).toBeTruthy();
    // Fail fast + loud if the backend isn't actually reachable. Without this the
    // server silently falls back to local JSON (each op ~5s) and the suite dies
    // by cumulative timeout instead of telling you the secrets are wrong.
    const health = await (await request.get('/api/health?deep=1')).json();
    expect(
      health.supabase?.reachable,
      `Supabase not reachable — check the TEST project SUPABASE_URL/SUPABASE_SERVICE_KEY secrets. Server error: ${health.supabase?.error}`,
    ).toBe(true);
  });

  test('unauthenticated read is rejected (401)', async ({ request }) => {
    const res = await request.get('/api/reports');
    expect(res.status()).toBe(401);
  });

  test('save → list → search → get-by-id → delete round-trip persists in Supabase', async ({ request }) => {
    await login(request);
    const title = `e2e-persist-${Date.now()}`;
    const id = await saveReport(request, { reportTitle: title, reportType: 'reports', projectName: 'e2e' });

    // appears in the list, with server-assigned ownership
    const list = await (await request.get('/api/reports?perPage=50')).json();
    const mine = list.reports.find((r) => r.id === id);
    expect(mine, 'saved report appears in the list').toBeTruthy();
    expect(mine.ownerId, 'ownerId set from the session').toBeTruthy();
    expect(mine.savedAt).toBeTruthy();

    // full-text search finds it
    const search = await (await request.get(`/api/reports?q=${encodeURIComponent(title)}`)).json();
    expect(search.reports.some((r) => r.id === id)).toBe(true);

    // get-by-ids (the export path)
    const byId = await (await request.get(`/api/reports?ids=${encodeURIComponent(id)}`)).json();
    expect(byId.reports[0]?.id).toBe(id);

    // delete, then confirm it's gone
    const del = await request.delete('/api/reports', { data: { id } });
    expect(del.status()).toBe(200);
    const after = await (await request.get(`/api/reports?q=${encodeURIComponent(title)}`)).json();
    expect(after.reports.some((r) => r.id === id)).toBe(false);
  });

  test('bulk-delete removes multiple reports', async ({ request }) => {
    await login(request);
    const ids = [];
    for (let i = 0; i < 2; i++) {
      ids.push(await saveReport(request, { reportTitle: `e2e-bulk-${Date.now()}-${i}`, reportType: 'reports' }));
    }
    const res = await request.post('/api/reports', { data: { action: 'bulk-delete', ids } });
    expect(res.status()).toBe(200);
    const list = await (await request.get('/api/reports?perPage=100')).json();
    expect(ids.every((id) => !list.reports.some((r) => r.id === id))).toBe(true);
  });

  test.afterAll(async ({ playwright }) => {
    if (SKIP || createdIds.length === 0) return;
    // Best-effort sweep of anything a failed test left behind.
    const ctx = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${process.env.E2E_PORT || 3030}` });
    try {
      await ctx.post('/api/login', { data: { password: PASSWORD } });
      await ctx.post('/api/reports', { data: { action: 'bulk-delete', ids: createdIds } });
    } catch {}
    await ctx.dispose();
  });
});
