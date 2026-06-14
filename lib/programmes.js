// Programme Planner (Pro) store + access control.
//
// Storage mirrors lib/reports.js / lib/users.js — Supabase when configured, else
// a local JSON file (data/programmes.json) for dev/test. The activity tree is a
// JSONB document on the programme row (last-write-wins on save, fine for MVP).
// Membership + per-user role live alongside; application code enforces access
// (the service_role key bypasses RLS).

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isSupabaseConfigured, getSupabaseClient } from './supabase.js';

const PROG_TABLE = process.env.SUPABASE_PROGRAMMES_TABLE || 'canlah_programmes';
const MEMBER_TABLE = process.env.SUPABASE_PROGRAMME_MEMBERS_TABLE || 'canlah_programme_members';
const DATA_DIR = process.env.DEV_PROGRAMMES_DIR || path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'programmes.json');

export const ROLES = ['pm', 'engineer', 'procurement', 'subcon', 'viewer'];
const EDITOR_ROLES = ['pm', 'engineer', 'procurement', 'subcon'];
const MANAGER_ROLES = ['pm']; // who can add/remove members & rename

/** Can this role modify activities? (everything but viewer) */
export function canEdit(role) { return EDITOR_ROLES.includes(role); }
/** Can this role manage members / rename / delete-soft? (pm, and the owner) */
export function canManage(role) { return MANAGER_ROLES.includes(role); }

const now = () => new Date().toISOString();
const newId = (p) => `${p}-${Date.now()}-${randomBytes(3).toString('hex')}`;

function supa() { return isSupabaseConfigured() ? getSupabaseClient() : null; }

// ── local JSON store ───────────────────────────────────────────────────────
async function loadStore() {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const all = JSON.parse(raw || '{}');
    return { programmes: all.programmes || [], members: all.members || [] };
  } catch {
    return { programmes: [], members: [] };
  }
}
async function saveStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// ── shaping ────────────────────────────────────────────────────────────────
const safeProgramme = (p, role = null) => p && {
  id: p.id,
  name: p.name,
  ownerId: p.owner_id ?? p.ownerId,
  startDate: p.start_date ?? p.startDate,
  activities: Array.isArray(p.activities) ? p.activities : (p.activities || []),
  createdAt: p.created_at ?? p.createdAt ?? null,
  updatedAt: p.updated_at ?? p.updatedAt ?? null,
  role,
};

// ── access resolution ────────────────────────────────────────────────────────
/** The caller's effective role on a programme, or null if no access. Owner ⇒ pm. */
async function roleOf(programmeId, userId) {
  const sb = supa();
  if (sb) {
    const { data: progs } = await sb.from(PROG_TABLE).select('owner_id').eq('id', programmeId).limit(1);
    const owner = (progs || [])[0];
    if (owner && owner.owner_id === userId) return 'pm';
    const { data: mem } = await sb.from(MEMBER_TABLE).select('role').eq('programme_id', programmeId).eq('user_id', userId).limit(1);
    return (mem || [])[0]?.role || null;
  }
  const store = await loadStore();
  const prog = store.programmes.find((x) => x.id === programmeId);
  if (!prog) return null;
  if (prog.owner_id === userId) return 'pm';
  return store.members.find((m) => m.programme_id === programmeId && m.user_id === userId)?.role || null;
}

// ── public API ───────────────────────────────────────────────────────────────

/** Programmes the user owns or is a member of (no activities payload — list view). */
export async function listProgrammesForUser(userId) {
  const sb = supa();
  if (sb) {
    const { data: owned } = await sb.from(PROG_TABLE).select('*').eq('owner_id', userId);
    const { data: mem } = await sb.from(MEMBER_TABLE).select('programme_id, role').eq('user_id', userId);
    const memById = new Map((mem || []).map((m) => [m.programme_id, m.role]));
    const memIds = [...memById.keys()].filter((id) => !(owned || []).some((p) => p.id === id));
    let memProgs = [];
    if (memIds.length) {
      const { data } = await sb.from(PROG_TABLE).select('*').in('id', memIds);
      memProgs = data || [];
    }
    const all = [
      ...(owned || []).map((p) => safeProgramme(p, 'pm')),
      ...memProgs.map((p) => safeProgramme(p, memById.get(p.id))),
    ];
    return all.map(({ activities, ...rest }) => ({ ...rest, activityCount: (activities || []).length }))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  const store = await loadStore();
  return store.programmes
    .map((p) => {
      if (p.owner_id === userId) return safeProgramme(p, 'pm');
      const m = store.members.find((x) => x.programme_id === p.id && x.user_id === userId);
      return m ? safeProgramme(p, m.role) : null;
    })
    .filter(Boolean)
    .map(({ activities, ...rest }) => ({ ...rest, activityCount: (activities || []).length }))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

/** Full programme (with activities + members) if accessible, else null. */
export async function getProgramme(id, userId) {
  const role = await roleOf(id, userId);
  if (!role) return null;
  const sb = supa();
  if (sb) {
    const { data } = await sb.from(PROG_TABLE).select('*').eq('id', id).limit(1);
    const prog = (data || [])[0];
    if (!prog) return null;
    const { data: members } = await sb.from(MEMBER_TABLE).select('*').eq('programme_id', id);
    const out = safeProgramme(prog, role);
    out.members = (members || []).map((m) => ({ userId: m.user_id, role: m.role, addedAt: m.added_at }));
    return out;
  }
  const store = await loadStore();
  const prog = store.programmes.find((x) => x.id === id);
  if (!prog) return null;
  const out = safeProgramme(prog, role);
  out.members = store.members.filter((m) => m.programme_id === id).map((m) => ({ userId: m.user_id, role: m.role, addedAt: m.added_at }));
  return out;
}

/** Create a programme; the creator becomes owner (effective role pm). */
export async function createProgramme({ name, ownerId, startDate, activities = [] } = {}) {
  if (!name || !String(name).trim()) throw new Error('name required');
  if (!ownerId) throw new Error('ownerId required');
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('startDate (YYYY-MM-DD) required');
  const row = {
    id: newId('pg'), name: String(name).trim(), owner_id: ownerId,
    start_date: startDate, activities, created_at: now(), updated_at: now(),
  };
  const sb = supa();
  if (sb) {
    const { error } = await sb.from(PROG_TABLE).insert([row]);
    if (error) throw error;
  } else {
    const store = await loadStore();
    store.programmes.push(row);
    await saveStore(store);
  }
  return safeProgramme(row, 'pm');
}

/** Update name / startDate / activities. Requires an editor role. */
export async function updateProgramme(id, userId, changes = {}) {
  const role = await roleOf(id, userId);
  if (!role) return { ok: false, reason: 'not_found' };
  if (!canEdit(role)) return { ok: false, reason: 'forbidden' };

  const patch = { updated_at: now() };
  if (changes.name !== undefined) {
    if (!String(changes.name).trim()) return { ok: false, reason: 'invalid', message: 'name cannot be empty' };
    patch.name = String(changes.name).trim();
  }
  if (changes.startDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(changes.startDate)) return { ok: false, reason: 'invalid', message: 'startDate must be YYYY-MM-DD' };
    patch.start_date = changes.startDate;
  }
  if (changes.activities !== undefined) {
    if (!Array.isArray(changes.activities)) return { ok: false, reason: 'invalid', message: 'activities must be an array' };
    patch.activities = changes.activities;
  }

  const sb = supa();
  if (sb) {
    const { error } = await sb.from(PROG_TABLE).update(patch).eq('id', id);
    if (error) throw error;
  } else {
    const store = await loadStore();
    const p = store.programmes.find((x) => x.id === id);
    if (!p) return { ok: false, reason: 'not_found' };
    Object.assign(p, patch);
    await saveStore(store);
  }
  return { ok: true };
}

/** Add or update a member's role. Requires owner/pm. */
export async function setMember(id, actorId, { userId, role } = {}) {
  const actorRole = await roleOf(id, actorId);
  if (!actorRole) return { ok: false, reason: 'not_found' };
  if (!canManage(actorRole)) return { ok: false, reason: 'forbidden' };
  if (!userId) return { ok: false, reason: 'invalid', message: 'userId required' };
  if (!ROLES.includes(role)) return { ok: false, reason: 'invalid', message: `role must be one of ${ROLES.join(', ')}` };

  const sb = supa();
  if (sb) {
    const { error } = await sb.from(MEMBER_TABLE).upsert([{ programme_id: id, user_id: userId, role, added_at: now() }], { onConflict: 'programme_id,user_id' });
    if (error) throw error;
  } else {
    const store = await loadStore();
    const existing = store.members.find((m) => m.programme_id === id && m.user_id === userId);
    if (existing) existing.role = role;
    else store.members.push({ programme_id: id, user_id: userId, role, added_at: now() });
    await saveStore(store);
  }
  return { ok: true };
}

/** Remove a member. Requires owner/pm. The owner can't be removed. */
export async function removeMember(id, actorId, userId) {
  const actorRole = await roleOf(id, actorId);
  if (!actorRole) return { ok: false, reason: 'not_found' };
  if (!canManage(actorRole)) return { ok: false, reason: 'forbidden' };
  const sb = supa();
  if (sb) {
    const { data } = await sb.from(PROG_TABLE).select('owner_id').eq('id', id).limit(1);
    if ((data || [])[0]?.owner_id === userId) return { ok: false, reason: 'invalid', message: 'cannot remove the owner' };
    const { error } = await sb.from(MEMBER_TABLE).delete().eq('programme_id', id).eq('user_id', userId);
    if (error) throw error;
  } else {
    const store = await loadStore();
    const prog = store.programmes.find((x) => x.id === id);
    if (prog?.owner_id === userId) return { ok: false, reason: 'invalid', message: 'cannot remove the owner' };
    store.members = store.members.filter((m) => !(m.programme_id === id && m.user_id === userId));
    await saveStore(store);
  }
  return { ok: true };
}

/** Delete a programme (and its members). Owner only. */
export async function deleteProgramme(id, userId) {
  const sb = supa();
  if (sb) {
    const { data } = await sb.from(PROG_TABLE).select('owner_id').eq('id', id).limit(1);
    const prog = (data || [])[0];
    if (!prog) return { ok: false, reason: 'not_found' };
    if (prog.owner_id !== userId) return { ok: false, reason: 'forbidden' };
    await sb.from(MEMBER_TABLE).delete().eq('programme_id', id);
    const { error } = await sb.from(PROG_TABLE).delete().eq('id', id);
    if (error) throw error;
    return { ok: true };
  }
  const store = await loadStore();
  const prog = store.programmes.find((x) => x.id === id);
  if (!prog) return { ok: false, reason: 'not_found' };
  if (prog.owner_id !== userId) return { ok: false, reason: 'forbidden' };
  store.programmes = store.programmes.filter((x) => x.id !== id);
  store.members = store.members.filter((m) => m.programme_id !== id);
  await saveStore(store);
  return { ok: true };
}
