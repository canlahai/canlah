import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Per-user auth (AUTH_MODE=users) against the local-JSON user store — no Supabase
// needed, so this runs in CI. Seeds an admin, then drives login + admin CRUD.
const PORT = 3033;
const BASE = `http://127.0.0.1:${PORT}`;
const USERS_DIR = mkdtempSync(join(tmpdir(), 'canlah-e2e-users-'));
let server;

test.beforeAll(async () => {
  // The server self-seeds the admin from SEED_ADMIN_* at startup (single process,
  // so no cross-process temp-file sharing). DEV_USERS_DIR isolates the store.
  server = spawn('node', ['dev-server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      AUTH_MODE: 'users',
      DEMO_MODE: 'false',
      BLOB_READ_WRITE_TOKEN: 'fake-for-auth-test',
      SESSION_SECRET: 'fixed-test-secret-do-not-use-in-prod',
      DEV_USERS_DIR: USERS_DIR,
      SEED_ADMIN_EMAIL: 'admin@firm.com',
      SEED_ADMIN_PASSWORD: 'password123',
      SEED_ADMIN_NAME: 'Admin',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_KEY: '',
      RATE_LIMIT_PER_MIN: '10000',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 30; i++) {
    try { const r = await fetch(`${BASE}/api/config`); if (r.ok) return; } catch {}
    await wait(200);
  }
  throw new Error('users-mode dev-server did not start');
});

test.afterAll(() => { if (server && !server.killed) server.kill('SIGKILL'); });

test('config advertises users auth mode', async ({ request }) => {
  const cfg = await (await request.get(`${BASE}/api/config`)).json();
  expect(cfg.authMode).toBe('users');
});

test('wrong password is rejected (401)', async ({ request }) => {
  const res = await request.post(`${BASE}/api/login`, { data: { email: 'admin@firm.com', password: 'wrong' } });
  expect(res.status()).toBe(401);
});

test('unknown email is rejected (401)', async ({ request }) => {
  const res = await request.post(`${BASE}/api/login`, { data: { email: 'ghost@firm.com', password: 'password123' } });
  expect(res.status()).toBe(401);
});

test('missing email/password is a 400', async ({ request }) => {
  const res = await request.post(`${BASE}/api/login`, { data: { password: 'password123' } });
  expect(res.status()).toBe(400);
});

test('valid login issues a session that unlocks protected endpoints', async ({ request }) => {
  const login = await request.post(`${BASE}/api/login`, { data: { email: 'admin@firm.com', password: 'password123' } });
  expect(login.status()).toBe(200);
  // request context retains the Set-Cookie → protected endpoint now works
  const reports = await request.get(`${BASE}/api/reports`);
  expect(reports.status()).toBe(200);
});

test('admin can create + list users; new user can log in', async ({ request }) => {
  await request.post(`${BASE}/api/login`, { data: { email: 'admin@firm.com', password: 'password123' } });

  const created = await request.post(`${BASE}/api/users`, {
    data: { email: 'bob@firm.com', password: 'password123', name: 'Bob', role: 'user' },
  });
  expect(created.status()).toBe(200);

  const list = await (await request.get(`${BASE}/api/users`)).json();
  expect(list.users.some((u) => u.email === 'bob@firm.com')).toBe(true);
  expect(list.users.every((u) => !('password_hash' in u))).toBe(true);

  // Bob (a fresh context) can sign in with the created credentials.
  const bob = await request.post(`${BASE}/api/login`, { data: { email: 'bob@firm.com', password: 'password123' } });
  expect(bob.status()).toBe(200);
});

test('non-admin cannot manage users (403)', async ({ request }) => {
  // log in as the non-admin Bob created above
  await request.post(`${BASE}/api/login`, { data: { email: 'bob@firm.com', password: 'password123' } });
  const res = await request.get(`${BASE}/api/users`);
  expect(res.status()).toBe(403);
});

test('new users default to the free tier; admin shows as pro in config', async ({ request }) => {
  // Bob (free user) — config reports his tier as free.
  await request.post(`${BASE}/api/login`, { data: { email: 'bob@firm.com', password: 'password123' } });
  const bobCfg = await (await request.get(`${BASE}/api/config`)).json();
  expect(bobCfg.tier).toBe('free');

  // Admin is treated as pro for gating.
  await request.post(`${BASE}/api/login`, { data: { email: 'admin@firm.com', password: 'password123' } });
  const adminCfg = await (await request.get(`${BASE}/api/config`)).json();
  expect(adminCfg.tier).toBe('pro');
});

test('admin can flip a user to pro; config reflects it', async ({ request }) => {
  await request.post(`${BASE}/api/login`, { data: { email: 'admin@firm.com', password: 'password123' } });
  const bob = (await (await request.get(`${BASE}/api/users`)).json()).users.find((u) => u.email === 'bob@firm.com');

  // Invalid tier is rejected.
  const bad = await request.patch(`${BASE}/api/users`, { data: { id: bob.id, tier: 'platinum' } });
  expect(bad.status()).toBe(400);

  // Flip to pro.
  const ok = await request.patch(`${BASE}/api/users`, { data: { id: bob.id, tier: 'pro' } });
  expect(ok.status()).toBe(200);

  // Bob now reads as pro.
  await request.post(`${BASE}/api/login`, { data: { email: 'bob@firm.com', password: 'password123' } });
  const bobCfg = await (await request.get(`${BASE}/api/config`)).json();
  expect(bobCfg.tier).toBe('pro');
});

test('non-admin cannot change tiers (403)', async ({ request }) => {
  await request.post(`${BASE}/api/login`, { data: { email: 'bob@firm.com', password: 'password123' } });
  const res = await request.patch(`${BASE}/api/users`, { data: { id: 'whatever', tier: 'free' } });
  expect(res.status()).toBe(403);
});

test('Programme Planner is pro-gated: free user 403, admin 200', async ({ request }) => {
  // Fresh free user → blocked from the Pro feature.
  await request.post(`${BASE}/api/login`, { data: { email: 'admin@firm.com', password: 'password123' } });
  await request.post(`${BASE}/api/users`, { data: { email: 'free@firm.com', password: 'password123', name: 'Free', role: 'user' } });

  await request.post(`${BASE}/api/login`, { data: { email: 'free@firm.com', password: 'password123' } });
  const blocked = await request.get(`${BASE}/api/programmes`);
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).code).toBe('pro_required');

  // Admin is treated as pro → allowed.
  await request.post(`${BASE}/api/login`, { data: { email: 'admin@firm.com', password: 'password123' } });
  const allowed = await request.get(`${BASE}/api/programmes`);
  expect(allowed.status()).toBe(200);

  // Promote the free user to pro → now allowed too.
  const free = (await (await request.get(`${BASE}/api/users`)).json()).users.find((u) => u.email === 'free@firm.com');
  await request.patch(`${BASE}/api/users`, { data: { id: free.id, tier: 'pro' } });
  await request.post(`${BASE}/api/login`, { data: { email: 'free@firm.com', password: 'password123' } });
  const nowOk = await request.get(`${BASE}/api/programmes`);
  expect(nowOk.status()).toBe(200);
});

test('logged-out request to a protected endpoint is 401', async ({ request }) => {
  const res = await request.get(`${BASE}/api/reports`);
  expect(res.status()).toBe(401);
});
