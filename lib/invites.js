// Programme invites — email-based, link-delivered, admin-managed.
//
// The main con (programme admin) invites a person by EMAIL with an access level
// (+ optional trade role). We mint a token and a shareable link; the invitee —
// who already has a CanLah account under that email (accounts are admin-created)
// — opens the link, signs in, and accepts, which grants programme membership.
// Acceptance verifies the signed-in email matches the invite (no link sharing).
//
// Storage mirrors lib/programmes.js — Supabase when configured, else local JSON.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isSupabaseConfigured, getSupabaseClient } from './supabase.js';
import { ACCESS_LEVELS, TRADE_ROLES, canManage, addMembership, getProgrammeName } from './programmes.js';

const INVITE_TABLE = process.env.SUPABASE_INVITES_TABLE || 'canlah_programme_invites';
const DATA_DIR = process.env.DEV_PROGRAMMES_DIR || path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'invites.json');

const now = () => new Date().toISOString();
const normEmail = (e) => String(e || '').trim().toLowerCase();
function supa() { return isSupabaseConfigured() ? getSupabaseClient() : null; }

async function loadStore() {
  try { const raw = await fs.readFile(STORE_FILE, 'utf8'); const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : []; }
  catch { return []; }
}
async function saveStore(rows) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

const safe = (r) => r && {
  token: r.token,
  programmeId: r.programme_id ?? r.programmeId,
  programmeName: r.programme_name ?? r.programmeName ?? null,
  email: r.email,
  accessLevel: r.access_level ?? r.accessLevel,
  tradeRole: r.trade_role ?? r.tradeRole ?? null,
  status: r.status || 'pending',
  invitedBy: r.invited_by ?? r.invitedBy ?? null,
  createdAt: r.created_at ?? r.createdAt ?? null,
};

// roleOf isn't exported; re-check admin via a getProgramme-free path would be
// circular, so we accept the caller's access level from the API layer instead.
/** Create an invite. `actorAccess` is the caller's access level on the programme. */
export async function createInvite({ programmeId, actorAccess, email, accessLevel, tradeRole } = {}) {
  if (!canManage(actorAccess)) return { ok: false, reason: 'forbidden' };
  const e = normEmail(email);
  if (!e || !/.+@.+\..+/.test(e)) return { ok: false, reason: 'invalid', message: 'a valid email is required' };
  if (!ACCESS_LEVELS.includes(accessLevel)) return { ok: false, reason: 'invalid', message: `accessLevel must be one of ${ACCESS_LEVELS.join(', ')}` };
  if (tradeRole != null && tradeRole !== '' && !TRADE_ROLES.includes(tradeRole)) return { ok: false, reason: 'invalid', message: 'invalid trade role' };

  const row = {
    token: randomBytes(18).toString('base64url'),
    programme_id: programmeId,
    programme_name: await getProgrammeName(programmeId),
    email: e,
    access_level: accessLevel,
    trade_role: tradeRole || null,
    status: 'pending',
    invited_by: arguments[0]?.invitedBy || null,
    created_at: now(),
  };
  const sb = supa();
  if (sb) { const { error } = await sb.from(INVITE_TABLE).insert([row]); if (error) throw error; }
  else { const rows = await loadStore(); rows.push(row); await saveStore(rows); }
  return { ok: true, invite: safe(row) };
}

/** Look up an invite by token (for the accept page). Returns safe invite or null. */
export async function getInvite(token) {
  if (!token) return null;
  const sb = supa();
  if (sb) { const { data } = await sb.from(INVITE_TABLE).select('*').eq('token', token).limit(1); return safe((data || [])[0]); }
  return safe((await loadStore()).find((r) => r.token === token));
}

/** Pending invites for a programme. Requires admin (actorAccess). */
export async function listInvites(programmeId, actorAccess) {
  if (!canManage(actorAccess)) return { ok: false, reason: 'forbidden' };
  const sb = supa();
  let rows;
  if (sb) { const { data } = await sb.from(INVITE_TABLE).select('*').eq('programme_id', programmeId); rows = data || []; }
  else rows = (await loadStore()).filter((r) => r.programme_id === programmeId);
  return { ok: true, invites: rows.map(safe).filter((r) => r.status === 'pending') };
}

/** Revoke a pending invite. Requires admin (actorAccess). */
export async function revokeInvite(token, actorAccess) {
  if (!canManage(actorAccess)) return { ok: false, reason: 'forbidden' };
  const sb = supa();
  if (sb) { const { error } = await sb.from(INVITE_TABLE).delete().eq('token', token); if (error) throw error; }
  else { const rows = (await loadStore()).filter((r) => r.token !== token); await saveStore(rows); }
  return { ok: true };
}

/**
 * Accept an invite. `user` = { id, email } of the signed-in user. The email must
 * match the invite (case-insensitive). Grants membership and marks accepted.
 */
export async function acceptInvite(token, user = {}) {
  const inv = await getInvite(token);
  if (!inv) return { ok: false, reason: 'not_found' };
  if (inv.status !== 'pending') return { ok: false, reason: 'invalid', message: 'invite already used or revoked' };
  if (!user.id) return { ok: false, reason: 'forbidden' };
  if (normEmail(user.email) !== normEmail(inv.email)) {
    return { ok: false, reason: 'forbidden', message: `this invite is for ${inv.email} — sign in with that account to accept` };
  }
  await addMembership(inv.programmeId, user.id, inv.accessLevel, inv.tradeRole);

  const sb = supa();
  if (sb) await sb.from(INVITE_TABLE).update({ status: 'accepted', accepted_by: user.id, accepted_at: now() }).eq('token', token);
  else {
    const rows = await loadStore();
    const r = rows.find((x) => x.token === token);
    if (r) { r.status = 'accepted'; r.accepted_by = user.id; r.accepted_at = now(); await saveStore(rows); }
  }
  return { ok: true, programmeId: inv.programmeId, accessLevel: inv.accessLevel };
}
