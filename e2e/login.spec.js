import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const AUTH_PORT = 3031;
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

  // Wait for server to be ready
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

test('logged-out: /api/reports returns 401', async ({ request }) => {
  const res = await request.get(`http://127.0.0.1:${AUTH_PORT}/api/reports`);
  expect(res.status()).toBe(401);
});

test('logged-out: /api/process returns 401', async ({ request }) => {
  const res = await request.post(`http://127.0.0.1:${AUTH_PORT}/api/process`, {
    data: { action: 'upload-start', filename: 'x.pdf' },
  });
  expect(res.status()).toBe(401);
});

test('login form: wrong password shows error', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${AUTH_PORT}/login`);
  await page.locator('#password').fill('wrong');
  await page.locator('#login-btn').click();
  await expect(page.locator('#login-err')).toContainText(/Invalid password/i);
});

test('login form: correct password → cookie set → protected endpoints work', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${AUTH_PORT}/login?return=/site-report`);
  await page.locator('#password').fill(PASSWORD);
  await Promise.all([
    page.waitForURL(/\/site-report/),
    page.locator('#login-btn').click(),
  ]);

  // Hit a protected endpoint via the page context (cookies attached)
  const res = await page.request.get(`http://127.0.0.1:${AUTH_PORT}/api/reports`);
  expect(res.status()).toBe(200);
});

test('frontend 401 handling: hitting a protected pillar redirects to /login', async ({ page }) => {
  // Clear any cookies from prior tests in this worker
  await page.context().clearCookies();

  await page.goto(`http://127.0.0.1:${AUTH_PORT}/site-report`);

  await page.locator('#file-input').setInputFiles({
    name: 'roster.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('fake'),
  });
  await page.locator('#analyse-btn').click();

  await page.waitForURL(/\/login/, { timeout: 5000 });
  expect(page.url()).toContain('return=');
});
