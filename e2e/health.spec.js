import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

// Boot a server wired to a Supabase project that does not resolve (.invalid TLD).
// This reproduces the real prod outage: env vars present ("configured") but the
// backend is unreachable. The shallow health check should stay green; the deep
// one should report 503 degraded so a monitor would actually fire.
const PORT = 3032;
let server;

test.beforeAll(async () => {
  server = spawn('node', ['dev-server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DEMO_MODE: 'false',
      BLOB_READ_WRITE_TOKEN: 'fake-for-health-test',
      SUPABASE_URL: 'https://nonexistent-canlah-test.invalid',
      SUPABASE_SERVICE_KEY: 'test-key',
      ACCESS_PASSWORD: 'test-access-password',
      SESSION_SECRET: 'fixed-test-secret-do-not-use-in-prod',
      RATE_LIMIT_PER_MIN: '10000',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/config`);
      if (r.ok) return;
    } catch {}
    await wait(200);
  }
  throw new Error('Health dev-server did not start');
});

test.afterAll(async () => {
  if (server && !server.killed) server.kill('SIGKILL');
});

test('shallow /api/health stays 200 even when Supabase is dead', async ({ request }) => {
  const res = await request.get(`http://127.0.0.1:${PORT}/api/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.supabase.configured).toBe(true);
  // shallow check must NOT probe reachability — that's what hid the outage
  expect('reachable' in body.supabase).toBe(false);
});

test('deep /api/health?deep=1 returns 503 degraded when Supabase is unreachable', async ({ request }) => {
  const res = await request.get(`http://127.0.0.1:${PORT}/api/health?deep=1`);
  expect(res.status()).toBe(503);
  const body = await res.json();
  expect(body.status).toBe('degraded');
  expect(body.supabase.configured).toBe(true);
  expect(body.supabase.reachable).toBe(false);
  expect(body.supabase.error).toBeTruthy();
});
