#!/usr/bin/env node
// Seed the first admin user (AUTH_MODE=users). Loads .env, then creates an admin.
//
//   node scripts/seed-admin.mjs <email> <password> [name]
//   ADMIN_EMAIL=a@b.co ADMIN_PASSWORD=secret123 node scripts/seed-admin.mjs
//
// Writes to Supabase if configured (run db/users.sql first), else data/users.json.

import { readFileSync } from 'node:fs';

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {}

const { createUser } = await import('../lib/users.js');

const email = process.argv[2] || process.env.ADMIN_EMAIL;
const password = process.argv[3] || process.env.ADMIN_PASSWORD;
const name = process.argv[4] || process.env.ADMIN_NAME || 'Admin';

if (!email || !password) {
  console.error('Usage: node scripts/seed-admin.mjs <email> <password> [name]');
  process.exit(1);
}

try {
  const u = await createUser({ email, password, name, role: 'admin' });
  console.log(`✅ Created admin "${u.email}" (id ${u.id}). Set AUTH_MODE=users and sign in.`);
} catch (e) {
  console.error('❌ ' + (e.message || e));
  process.exit(1);
}
