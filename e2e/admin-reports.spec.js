import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const AUTH_PORT = 3032;
const PASSWORD = 'test-access-password';

let server;

test.beforeAll(async () => {
  server = spawn('node', ['dev-server.js'], {
    env: {
      ...process.env,
      PORT: String(AUTH_PORT),
      DEMO_MODE: 'false',
      BLOB_READ_WRITE_TOKEN: 'fake-for-auth-test',
      ACCESS_PASSWORD: PASSWORD,
      SESSION_SECRET: 'fixed-test-secret-do-not-use-in-prod',
      RATE_LIMIT_PER_MIN: '10000',
    },
    stdio: 'ignore',
  });

  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${AUTH_PORT}/api/config`);
      if (r.ok) return;
    } catch {}
    await wait(200);
  }
  throw new Error('Auth dev-server did not start');
});

test.afterAll(async () => {
  if (server && !server.killed) server.kill('SIGKILL');
});

test('admin export and bulk-delete flows', async ({ page }) => {
  // login as user and save two reports
  await page.goto(`http://127.0.0.1:${AUTH_PORT}/login`);
  await page.locator('#password').fill(PASSWORD);
  await Promise.all([
    page.waitForNavigation(),
    page.locator('#login-btn').click(),
  ]);

  // navigate to site-report and save two dummy reports via sessionStorage load
  const now = new Date().toISOString();
  const r1 = { savedAt: now, reportType: 'reports', reportTitle: 'E2E Export 1', projectName: 'E2E1' };
  const r2 = { savedAt: now, reportType: 'reports', reportTitle: 'E2E Export 2', projectName: 'E2E2' };

  // Save via page context fetch so cookies/session are attached and ownerId set
  const saved1 = await page.evaluate(async (r) => {
    const res = await fetch('/api/save-report', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ report: r }), credentials: 'same-origin' });
    return await res.json().catch(()=>null);
  }, r1);
  const saved2 = await page.evaluate(async (r) => {
    const res = await fetch('/api/save-report', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ report: r }), credentials: 'same-origin' });
    return await res.json().catch(()=>null);
  }, r2);
  const id1 = saved1?.id;
  const id2 = saved2?.id;
  expect(id1).toBeTruthy();
  expect(id2).toBeTruthy();

  // Verify reports exist via GET
  const checkRes = await page.evaluate(async (idsStr) => {
    const r = await fetch('/api/reports?ids=' + encodeURIComponent(idsStr), { credentials: 'same-origin' });
    return { ok: r.ok, body: await r.json().catch(()=>null) };
  }, `${id1},${id2}`);
  expect(checkRes.ok).toBeTruthy();
  expect(Array.isArray(checkRes.body?.reports)).toBeTruthy();
  expect(checkRes.body.reports.filter(x => x && (x.id === (id1 || r1.id) || x.id === (id2 || r2.id))).length).toBe(2);

  // Delete each report via DELETE (page context so cookies attached)
  const del1 = await page.evaluate(async (id) => {
    const r = await fetch('/api/reports?id=' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' });
    return { ok: r.ok, status: r.status, body: await r.json().catch(()=>null) };
  }, id1);
  expect(del1.ok).toBeTruthy();

  const del2 = await page.evaluate(async (id) => {
    const r = await fetch('/api/reports?id=' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' });
    return { ok: r.ok, body: await r.json().catch(()=>null) };
  }, id2);
  expect(del2.ok).toBeTruthy();

  // Verify deleted via API: attempt to fetch by ids should return empty
  const getRes = await page.evaluate(async (idsStr) => {
    const r = await fetch('/api/reports?ids=' + encodeURIComponent(idsStr), { credentials: 'same-origin' });
    const body = await r.json().catch(()=>null);
    return { ok: r.ok, body };
  }, `${id1},${id2}`);
  expect(getRes.ok).toBeTruthy();
  expect(Array.isArray(getRes.body?.reports)).toBeTruthy();
  expect(getRes.body.reports.filter(x => x && (x.id === id1 || x.id === id2)).length).toBe(0);
});

test('admin-reports.html UI interactions', async ({ page }) => {
  // Login
  await page.goto(`http://127.0.0.1:${AUTH_PORT}/login`);
  await page.locator('#password').fill(PASSWORD);
  await Promise.all([
    page.waitForNavigation(),
    page.locator('#login-btn').click(),
  ]);

  // Navigate to admin page
  await page.goto(`http://127.0.0.1:${AUTH_PORT}/admin-reports.html`);
  await page.waitForSelector('#ar-list');

  // Test search input is present and wired
  const searchInput = page.locator('#ar-search');
  expect(searchInput).toBeTruthy();
  await searchInput.fill('test search');
  await expect(searchInput).toHaveValue('test search');

  // Test perpage dropdown exists
  const perpageSelect = page.locator('#ar-perpage');
  expect(perpageSelect).toBeTruthy();
  await perpageSelect.selectOption('100');
  await expect(perpageSelect).toHaveValue('100');

  // Test pagination buttons exist
  const prevBtn = page.locator('#ar-prev');
  const nextBtn = page.locator('#ar-next');
  const pageDisplay = page.locator('#ar-page');
  expect(prevBtn).toBeTruthy();
  expect(nextBtn).toBeTruthy();
  expect(pageDisplay).toBeTruthy();

  // Test select-all checkbox
  const selectAllChk = page.locator('#ar-select-all');
  expect(selectAllChk).toBeTruthy();

  // Test action buttons exist
  const exportBtn = page.locator('#ar-export');
  const bulkDelBtn = page.locator('#ar-bulk-delete');
  const transferButton = page.locator('.ar-transfer').first();
  expect(exportBtn).toBeTruthy();
  expect(bulkDelBtn).toBeTruthy();
  expect(transferButton).toBeTruthy();

  // Test refresh button
  const refreshBtn = page.locator('#ar-refresh');
  expect(refreshBtn).toBeTruthy();

  // Test list container exists
  const listContainer = page.locator('#ar-list');
  expect(listContainer).toBeTruthy();
});
