// Per-user accounts for CanLah (AUTH_MODE=users). Admin-managed: no open signup.
//
// Storage mirrors lib/reports.js — Supabase when configured, else a local JSON
// file (data/users.json) for dev/test. Passwords are scrypt-hashed (node:crypto,
// no deps). The existing HMAC session cookie (lib/auth.js) is reused; this module
// only authenticates credentials and manages the user records.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isSupabaseConfigured, getSupabaseClient } from './supabase.js';

const USERS_TABLE = process.env.SUPABASE_USERS_TABLE || 'canlah_users';
const DATA_DIR = process.env.DEV_USERS_DIR || path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// ── password hashing (pure) ────────────────────────────────────────────
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  let test;
  try {
    test = scryptSync(String(password), salt, 64).toString('hex');
  } catch {
    return false;
  }
  const a = Buffer.from(test, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const normEmail = (e) => String(e || '').trim().toLowerCase();
const currentPeriod = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM'
const safe = (u) => u && {
  id: u.id, email: u.email, name: u.name || null, role: u.role || 'user',
  disabled: !!u.disabled, tier: u.tier || 'free', readsThisMonth: u.reads_this_month || 0,
  createdAt: u.createdAt || u.created_at || null,
};

// ── local JSON store ───────────────────────────────────────────────────
async function loadFile() {
  try {
    const raw = await fs.readFile(USERS_FILE, 'utf8');
    const all = JSON.parse(raw || '[]');
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}
async function saveFile(users) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function supa() {
  return isSupabaseConfigured() ? getSupabaseClient() : null;
}

// ── public API ─────────────────────────────────────────────────────────

/** Create a user. Throws on duplicate email. Returns the safe (hash-free) user. */
export async function createUser({ email, password, name = null, role = 'user' } = {}) {
  const e = normEmail(email);
  if (!e || !/.+@.+/.test(e)) throw new Error('valid email required');
  if (!password || String(password).length < 8) throw new Error('password must be at least 8 characters');
  if (role !== 'user' && role !== 'admin') throw new Error('role must be "user" or "admin"');

  const row = {
    id: 'u-' + Date.now() + '-' + randomBytes(3).toString('hex'),
    email: e,
    password_hash: hashPassword(password),
    name,
    role,
    disabled: false,
    tier: 'free',
    reads_this_month: 0,
    reads_period: currentPeriod(),
    created_at: new Date().toISOString(),
  };

  const sb = supa();
  if (sb) {
    const existing = await getByEmail(e);
    if (existing) throw new Error('email already registered');
    const { error } = await sb.from(USERS_TABLE).insert([row]);
    if (error) throw error;
  } else {
    const users = await loadFile();
    if (users.some((u) => normEmail(u.email) === e)) throw new Error('email already registered');
    users.push(row);
    await saveFile(users);
  }
  return safe(row);
}

async function getByEmail(email) {
  const e = normEmail(email);
  const sb = supa();
  if (sb) {
    const { data, error } = await sb.from(USERS_TABLE).select('*').eq('email', e).limit(1);
    if (error) throw error;
    return (data || [])[0] || null;
  }
  const users = await loadFile();
  return users.find((u) => normEmail(u.email) === e) || null;
}

/** Verify email + password. Returns the safe user on success, else null. */
export async function verifyCredentials(email, password) {
  const user = await getByEmail(email).catch(() => null);
  if (!user || user.disabled) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return safe(user);
}

/** List all users (hash-free). */
export async function listUsers() {
  const sb = supa();
  if (sb) {
    const { data, error } = await sb.from(USERS_TABLE).select('*').order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(safe);
  }
  return (await loadFile()).map(safe);
}

/** Enable/disable a user by id. Returns true if a row changed. */
export async function setUserDisabled(id, disabled) {
  const sb = supa();
  if (sb) {
    const { error } = await sb.from(USERS_TABLE).update({ disabled: !!disabled }).eq('id', id);
    if (error) throw error;
    return true;
  }
  const users = await loadFile();
  const u = users.find((x) => x.id === id);
  if (!u) return false;
  u.disabled = !!disabled;
  await saveFile(users);
  return true;
}

async function getRowById(id) {
  const sb = supa();
  if (sb) {
    const { data, error } = await sb.from(USERS_TABLE).select('*').eq('id', id).limit(1);
    if (error) throw error;
    return (data || [])[0] || null;
  }
  return (await loadFile()).find((u) => u.id === id) || null;
}

/** Get one user (hash-free) by id, or null. */
export async function getUserById(id) {
  return safe(await getRowById(id));
}

/** Set a user's tier ('free' | 'pro'). Returns true if changed. */
export async function setUserTier(id, tier) {
  if (tier !== 'free' && tier !== 'pro') throw new Error('tier must be "free" or "pro"');
  const sb = supa();
  if (sb) {
    const { error } = await sb.from(USERS_TABLE).update({ tier }).eq('id', id);
    if (error) throw error;
    return true;
  }
  const users = await loadFile();
  const u = users.find((x) => x.id === id);
  if (!u) return false;
  u.tier = tier;
  await saveFile(users);
  return true;
}

/**
 * Count one document read against a user's monthly quota. Pro and admin are
 * unlimited. Free users get `limit` reads/month (auto-resets each calendar month).
 * Returns { ok, unlimited?, remaining?, limit?, reason? }. Read-modify-write —
 * fine for pilot volumes; back with an RPC if it ever needs to be atomic.
 */
export async function consumeRead(id, { limit = 10 } = {}) {
  const row = await getRowById(id);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.role === 'admin' || (row.tier || 'free') === 'pro') return { ok: true, unlimited: true };

  const period = currentPeriod();
  let reads = row.reads_period === period ? (row.reads_this_month || 0) : 0;
  if (reads >= limit) return { ok: false, reason: 'limit', limit, remaining: 0 };
  reads += 1;

  const sb = supa();
  if (sb) {
    const { error } = await sb.from(USERS_TABLE).update({ reads_this_month: reads, reads_period: period }).eq('id', id);
    if (error) throw error;
  } else {
    const users = await loadFile();
    const u = users.find((x) => x.id === id);
    if (u) { u.reads_this_month = reads; u.reads_period = period; await saveFile(users); }
  }
  return { ok: true, remaining: Math.max(0, limit - reads) };
}

/** Are per-user accounts the active auth mode? */
export function usersAuthEnabled() {
  return process.env.AUTH_MODE === 'users';
}

/**
 * Does this caller have Pro access to gated features (e.g. Programme Planner)?
 * Demo mode and shared-auth mode are open (single trusted firm / local dev).
 * In per-user mode, admins are always Pro; everyone else needs tier === 'pro'.
 * `caller` is the shape returned by authCheck (needs `id`, optional `role`/`demo`).
 */
export async function hasProAccess(caller) {
  if (!caller || !caller.ok) return false;
  if (caller.demo) return true;
  if (!usersAuthEnabled()) return true;
  if (caller.role === 'admin') return true;
  if (!caller.id) return false;
  try {
    const u = await getUserById(caller.id);
    return !!u && (u.tier || 'free') === 'pro';
  } catch {
    return false;
  }
}
