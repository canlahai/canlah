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
import { computeSchedule } from './cpm.js';

const PROG_TABLE = process.env.SUPABASE_PROGRAMMES_TABLE || 'canlah_programmes';
const MEMBER_TABLE = process.env.SUPABASE_PROGRAMME_MEMBERS_TABLE || 'canlah_programme_members';
const DATA_DIR = process.env.DEV_PROGRAMMES_DIR || path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'programmes.json');

// Access level = permission tier (what you can DO). Trade role = discipline tag
// (who you ARE on site) — descriptive, no permission meaning. The programme
// owner (main con) is always 'admin'.
export const ACCESS_LEVELS = ['admin', 'editor', 'viewer'];
export const TRADE_ROLES = ['pm', 'engineer', 'procurement', 'subcon', 'supervisor'];
// Back-compat alias (older callers imported ROLES expecting access levels).
export const ROLES = ACCESS_LEVELS;

/** Can this access level modify activities? (editor or admin) */
export function canEdit(level) { return level === 'editor' || level === 'admin'; }
/** Can this access level manage members / invites / rename? (admin only) */
export function canManage(level) { return level === 'admin'; }

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
const memberAccess = (m) => m && (m.access_level ?? m.accessLevel ?? m.role ?? 'viewer');
const memberTrade = (m) => (m && (m.trade_role ?? m.tradeRole)) || null;

const safeProgramme = (p, access = null) => p && {
  id: p.id,
  name: p.name,
  ownerId: p.owner_id ?? p.ownerId,
  startDate: p.start_date ?? p.startDate,
  endDate: p.end_date ?? p.endDate ?? null,   // optional target/contract end
  baseline: p.baseline ?? null,               // saved baseline snapshot (S-curve)
  activities: Array.isArray(p.activities) ? p.activities : (p.activities || []),
  createdAt: p.created_at ?? p.createdAt ?? null,
  updatedAt: p.updated_at ?? p.updatedAt ?? null,
  access,          // caller's access level: admin | editor | viewer
  role: access,    // back-compat alias
};

// ── access resolution ────────────────────────────────────────────────────────
/** The caller's access level on a programme, or null if no access. Owner ⇒ admin. */
async function roleOf(programmeId, userId) {
  const sb = supa();
  if (sb) {
    const { data: progs } = await sb.from(PROG_TABLE).select('owner_id').eq('id', programmeId).limit(1);
    const owner = (progs || [])[0];
    if (owner && owner.owner_id === userId) return 'admin';
    const { data: mem } = await sb.from(MEMBER_TABLE).select('*').eq('programme_id', programmeId).eq('user_id', userId).limit(1);
    return (mem || [])[0] ? memberAccess((mem || [])[0]) : null;
  }
  const store = await loadStore();
  const prog = store.programmes.find((x) => x.id === programmeId);
  if (!prog) return null;
  if (prog.owner_id === userId) return 'admin';
  const m = store.members.find((m) => m.programme_id === programmeId && m.user_id === userId);
  return m ? memberAccess(m) : null;
}

// ── readiness + portfolio stats (server-side mirrors of programme.html) ───────
// Kept identical to the client helpers so the dashboard agrees with the editor.
const _today = () => new Date().toISOString().slice(0, 10);
function deliveryLate(d) {
  if (!d) return false;
  if (d.status === 'delayed') return true;
  if (d.status === 'delivered') return false;
  return !!(d.neededBy && d.neededBy < _today());
}
function activityReady(a) {
  if (a.status === 'blocked') return false;
  const cl = a.checklist || [];
  if (cl.length && !cl.every((c) => (c.status || 'pending') === 'complied')) return false;
  if ((a.deliveries || []).some(deliveryLate)) return false;
  return true;
}

/** Roll-up stats for one programme: progress, risk, and computed vs target end. */
function summarise(p) {
  const acts = Array.isArray(p.activities) ? p.activities : [];
  const total = acts.length;
  const done = acts.filter((a) => a.status === 'done').length;
  const inProgress = acts.filter((a) => a.status === 'in_progress').length;
  const blocked = acts.filter((a) => a.status === 'blocked').length;
  const atRisk = acts.filter((a) => a.status === 'blocked' || !activityReady(a)).length;
  const percentComplete = total ? Math.round((done / total) * 100) : 0;

  let computedEnd = null;
  if (total && p.startDate) {
    try {
      const tasks = acts.map((a) => ({
        id: a.id,
        name: a.name,
        durationDays: Math.max(0, Math.round(Number(a.durationDays) || 0)),
        predecessors: (a.predecessors || []).map((x) =>
          (typeof x === 'string' ? { id: x } : { id: x.id, type: x.type, lagDays: Number(x.lagDays) || 0 })),
      }));
      computedEnd = computeSchedule(tasks, { startDate: p.startDate }).projectEnd;
    } catch { computedEnd = null; } // cycles / bad deps → no computed end, not a crash
  }
  const targetEnd = p.endDate || null;
  const overrunDays = (computedEnd && targetEnd)
    ? Math.round((Date.parse(computedEnd) - Date.parse(targetEnd)) / 86_400_000)
    : null;

  return { total, done, inProgress, blocked, atRisk, percentComplete, computedEnd, targetEnd, overrunDays };
}

// ── public API ───────────────────────────────────────────────────────────────

/** Every programme the caller owns or belongs to, fully shaped (with activities). */
export async function accessibleProgrammes(userId) {
  const sb = supa();
  if (sb) {
    const { data: owned } = await sb.from(PROG_TABLE).select('*').eq('owner_id', userId);
    const { data: mem } = await sb.from(MEMBER_TABLE).select('*').eq('user_id', userId);
    const memById = new Map((mem || []).map((m) => [m.programme_id, memberAccess(m)]));
    const memIds = [...memById.keys()].filter((id) => !(owned || []).some((p) => p.id === id));
    let memProgs = [];
    if (memIds.length) {
      const { data } = await sb.from(PROG_TABLE).select('*').in('id', memIds);
      memProgs = data || [];
    }
    return [
      ...(owned || []).map((p) => safeProgramme(p, 'admin')),
      ...memProgs.map((p) => safeProgramme(p, memById.get(p.id))),
    ];
  }
  const store = await loadStore();
  return store.programmes
    .map((p) => {
      if (p.owner_id === userId) return safeProgramme(p, 'admin');
      const m = store.members.find((x) => x.programme_id === p.id && x.user_id === userId);
      return m ? safeProgramme(p, memberAccess(m)) : null;
    })
    .filter(Boolean);
}

const byRecent = (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '');

/** Programmes the user owns or is a member of (no activities payload — list view). */
export async function listProgrammesForUser(userId) {
  const all = await accessibleProgrammes(userId);
  return all.map(({ activities, ...rest }) => ({ ...rest, activityCount: (activities || []).length }))
    .sort(byRecent);
}

/** Same set, plus per-programme roll-up stats — powers the portfolio dashboard. */
export async function listPortfolioForUser(userId) {
  const all = await accessibleProgrammes(userId);
  return all.map(({ activities, ...rest }) => ({
    ...rest,
    activityCount: (activities || []).length,
    stats: summarise({ ...rest, activities }),
  })).sort(byRecent);
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
    out.members = (members || []).map((m) => ({ userId: m.user_id, accessLevel: memberAccess(m), tradeRole: memberTrade(m), addedAt: m.added_at }));
    return out;
  }
  const store = await loadStore();
  const prog = store.programmes.find((x) => x.id === id);
  if (!prog) return null;
  const out = safeProgramme(prog, role);
  out.members = store.members.filter((m) => m.programme_id === id).map((m) => ({ userId: m.user_id, accessLevel: memberAccess(m), tradeRole: memberTrade(m), addedAt: m.added_at }));
  return out;
}

/** Create a programme; the creator becomes owner (effective role pm). */
export async function createProgramme({ name, ownerId, startDate, endDate, activities = [] } = {}) {
  if (!name || !String(name).trim()) throw new Error('name required');
  if (!ownerId) throw new Error('ownerId required');
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('startDate (YYYY-MM-DD) required');
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('endDate must be YYYY-MM-DD');
  if (endDate && endDate < startDate) throw new Error('endDate must be on or after startDate');
  const row = {
    id: newId('pg'), name: String(name).trim(), owner_id: ownerId,
    start_date: startDate, activities, created_at: now(), updated_at: now(),
  };
  // Only persist end_date when set — keeps inserts working even if the prod
  // end_date column hasn't been added yet (degrades the optional target end only).
  if (endDate) row.end_date = endDate;
  const sb = supa();
  if (sb) {
    const { error } = await sb.from(PROG_TABLE).insert([row]);
    if (error) throw error;
  } else {
    const store = await loadStore();
    store.programmes.push(row);
    await saveStore(store);
  }
  return safeProgramme(row, 'admin');
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
  if (changes.endDate !== undefined) {
    if (changes.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(changes.endDate)) return { ok: false, reason: 'invalid', message: 'endDate must be YYYY-MM-DD' };
    patch.end_date = changes.endDate || null;
  }
  if (changes.activities !== undefined) {
    if (!Array.isArray(changes.activities)) return { ok: false, reason: 'invalid', message: 'activities must be an array' };
    patch.activities = changes.activities;
  }
  // Baseline snapshot (S-curve). Only written when provided — deploy-safe if the
  // prod `baseline` column hasn't been added yet.
  if (changes.baseline !== undefined) patch.baseline = changes.baseline;

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

const ACTIVITY_STATUSES = ['todo', 'in_progress', 'done', 'blocked'];
const ACTIVITY_FIELDS = ['name', 'trade', 'section', 'durationDays', 'predecessors', 'assignee',
  'status', 'parties', 'checklist', 'deliveries', 'blockedReason', 'responsibleParty', 'externalDeps',
  'progress', 'photos', 'cost'];

/**
 * Collaborative, per-activity update. Patches ONE activity within a programme
 * (read-modify-write on the activities array) so different parties can update
 * different activities without clobbering the whole schedule. Appends an
 * attributed entry to the activity's update log. Requires an editor role.
 */
export async function updateActivity(id, actorId, activityId, patch = {}, note) {
  const role = await roleOf(id, actorId);
  if (!role) return { ok: false, reason: 'not_found' };
  if (!canEdit(role)) return { ok: false, reason: 'forbidden' };
  if (!activityId) return { ok: false, reason: 'invalid', message: 'activityId required' };
  if (patch.status !== undefined && !ACTIVITY_STATUSES.includes(patch.status)) {
    return { ok: false, reason: 'invalid', message: `status must be one of ${ACTIVITY_STATUSES.join(', ')}` };
  }
  if (patch.checklist !== undefined && !Array.isArray(patch.checklist)) return { ok: false, reason: 'invalid', message: 'checklist must be an array' };
  if (patch.parties !== undefined && !Array.isArray(patch.parties)) return { ok: false, reason: 'invalid', message: 'parties must be an array' };
  if (patch.deliveries !== undefined && !Array.isArray(patch.deliveries)) return { ok: false, reason: 'invalid', message: 'deliveries must be an array' };
  if (patch.externalDeps !== undefined && !Array.isArray(patch.externalDeps)) return { ok: false, reason: 'invalid', message: 'externalDeps must be an array' };
  if (patch.photos !== undefined && !Array.isArray(patch.photos)) return { ok: false, reason: 'invalid', message: 'photos must be an array' };
  if (patch.progress !== undefined) { const n = Number(patch.progress); if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, reason: 'invalid', message: 'progress must be 0–100' }; patch.progress = Math.round(n); }
  if (patch.cost !== undefined) { const n = Number(patch.cost); if (!Number.isFinite(n) || n < 0) return { ok: false, reason: 'invalid', message: 'cost must be a non-negative number' }; patch.cost = n; }

  const apply = (activities) => {
    const a = activities.find((x) => x.id === activityId);
    if (!a) return null;
    for (const f of ACTIVITY_FIELDS) if (patch[f] !== undefined) a[f] = patch[f];
    const entry = { by: actorId, role, at: now() };
    if (note) entry.note = String(note).slice(0, 500);
    if (patch.status !== undefined) entry.status = patch.status;
    a.updates = [...(Array.isArray(a.updates) ? a.updates : []), entry].slice(-50);
    return a;
  };

  const sb = supa();
  if (sb) {
    const { data, error } = await sb.from(PROG_TABLE).select('activities').eq('id', id).limit(1);
    if (error) throw error;
    const row = (data || [])[0];
    if (!row) return { ok: false, reason: 'not_found' };
    const activities = Array.isArray(row.activities) ? row.activities : [];
    const a = apply(activities);
    if (!a) return { ok: false, reason: 'invalid', message: 'activity not found' };
    const { error: upErr } = await sb.from(PROG_TABLE).update({ activities, updated_at: now() }).eq('id', id);
    if (upErr) throw upErr;
    return { ok: true, activity: a };
  }
  const store = await loadStore();
  const p = store.programmes.find((x) => x.id === id);
  if (!p) return { ok: false, reason: 'not_found' };
  p.activities = Array.isArray(p.activities) ? p.activities : [];
  const a = apply(p.activities);
  if (!a) return { ok: false, reason: 'invalid', message: 'activity not found' };
  p.updated_at = now();
  await saveStore(store);
  return { ok: true, activity: a };
}

/** Add or update a member's access level (+ optional trade role). Admin only. */
export async function setMember(id, actorId, { userId, accessLevel, role, tradeRole } = {}) {
  const level = accessLevel || role; // accept legacy `role` as the access level
  const actorAccess = await roleOf(id, actorId);
  if (!actorAccess) return { ok: false, reason: 'not_found' };
  if (!canManage(actorAccess)) return { ok: false, reason: 'forbidden' };
  if (!userId) return { ok: false, reason: 'invalid', message: 'userId required' };
  if (!ACCESS_LEVELS.includes(level)) return { ok: false, reason: 'invalid', message: `accessLevel must be one of ${ACCESS_LEVELS.join(', ')}` };
  if (tradeRole != null && tradeRole !== '' && !TRADE_ROLES.includes(tradeRole)) return { ok: false, reason: 'invalid', message: `tradeRole must be one of ${TRADE_ROLES.join(', ')}` };
  const trade = tradeRole || null;

  const sb = supa();
  if (sb) {
    const { error } = await sb.from(MEMBER_TABLE).upsert([{ programme_id: id, user_id: userId, access_level: level, trade_role: trade, added_at: now() }], { onConflict: 'programme_id,user_id' });
    if (error) throw error;
  } else {
    const store = await loadStore();
    const existing = store.members.find((m) => m.programme_id === id && m.user_id === userId);
    if (existing) { existing.access_level = level; existing.trade_role = trade; delete existing.role; }
    else store.members.push({ programme_id: id, user_id: userId, access_level: level, trade_role: trade, added_at: now() });
    await saveStore(store);
  }
  return { ok: true };
}

/**
 * Add a membership WITHOUT a permission check — for invite acceptance, where the
 * invite token is the authorization. Returns the resolved access level.
 */
export async function addMembership(programmeId, userId, accessLevel = 'viewer', tradeRole = null) {
  const level = ACCESS_LEVELS.includes(accessLevel) ? accessLevel : 'viewer';
  const trade = TRADE_ROLES.includes(tradeRole) ? tradeRole : null;
  const sb = supa();
  if (sb) {
    const { error } = await sb.from(MEMBER_TABLE).upsert([{ programme_id: programmeId, user_id: userId, access_level: level, trade_role: trade, added_at: now() }], { onConflict: 'programme_id,user_id' });
    if (error) throw error;
  } else {
    const store = await loadStore();
    const existing = store.members.find((m) => m.programme_id === programmeId && m.user_id === userId);
    if (existing) { existing.access_level = level; existing.trade_role = trade; delete existing.role; }
    else store.members.push({ programme_id: programmeId, user_id: userId, access_level: level, trade_role: trade, added_at: now() });
    await saveStore(store);
  }
  return { ok: true, accessLevel: level, tradeRole: trade };
}

/** Programme name without a membership check (for the invite accept page). */
export async function getProgrammeName(id) {
  const sb = supa();
  if (sb) {
    const { data } = await sb.from(PROG_TABLE).select('name').eq('id', id).limit(1);
    return (data || [])[0]?.name || null;
  }
  const store = await loadStore();
  return store.programmes.find((x) => x.id === id)?.name || null;
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
