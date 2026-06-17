// Subcontractor / contact directory — an owner's reusable address book.
//
// A main contractor builds up a list of the subs, consultants and people they
// work with (email + company + trade), then invites them onto any programme in
// one click instead of re-typing emails each time. Owner-scoped; storage mirrors
// lib/programmes.js — Supabase when configured, else a local JSON file.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isSupabaseConfigured, getSupabaseClient } from './supabase.js';
import { TRADE_ROLES } from './programmes.js';

const TABLE = process.env.SUPABASE_CONTACTS_TABLE || 'canlah_contacts';
const DATA_DIR = process.env.DEV_PROGRAMMES_DIR || path.join(process.cwd(), 'data');
const STORE_FILE = path.join(DATA_DIR, 'contacts.json');

const now = () => new Date().toISOString();
const newId = () => `ct-${Date.now()}-${randomBytes(3).toString('hex')}`;
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
  id: r.id,
  email: r.email,
  name: r.name ?? null,
  company: r.company ?? null,
  tradeRole: r.trade_role ?? r.tradeRole ?? null,
  createdAt: r.created_at ?? r.createdAt ?? null,
};

const validTrade = (t) => t == null || t === '' || TRADE_ROLES.includes(t);

/** All of an owner's saved contacts, most-recent first. */
export async function listContacts(ownerId) {
  const sb = supa();
  let rows;
  if (sb) { const { data } = await sb.from(TABLE).select('*').eq('owner_id', ownerId); rows = data || []; }
  else rows = (await loadStore()).filter((r) => r.owner_id === ownerId);
  return rows.map(safe).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/**
 * Add or update a contact (upsert by owner+email). Returns the saved contact.
 * `reason` on failure: 'invalid'.
 */
export async function addContact(ownerId, { email, name, company, tradeRole } = {}) {
  const e = normEmail(email);
  if (!e || !/.+@.+\..+/.test(e)) return { ok: false, reason: 'invalid', message: 'a valid email is required' };
  if (!validTrade(tradeRole)) return { ok: false, reason: 'invalid', message: 'invalid trade role' };
  const trade = tradeRole || null;
  const sb = supa();
  if (sb) {
    // Look up an existing row to preserve its id/created_at on update.
    const { data: existing } = await sb.from(TABLE).select('*').eq('owner_id', ownerId).eq('email', e).limit(1);
    const prev = (existing || [])[0];
    const row = {
      id: prev?.id || newId(), owner_id: ownerId, email: e,
      name: name ?? prev?.name ?? null, company: company ?? prev?.company ?? null,
      trade_role: trade ?? prev?.trade_role ?? null,
      created_at: prev?.created_at || now(),
    };
    const { error } = await sb.from(TABLE).upsert([row], { onConflict: 'owner_id,email' });
    if (error) throw error;
    return { ok: true, contact: safe(row) };
  }
  const rows = await loadStore();
  const prev = rows.find((r) => r.owner_id === ownerId && r.email === e);
  if (prev) {
    if (name !== undefined) prev.name = name;
    if (company !== undefined) prev.company = company;
    if (tradeRole !== undefined) prev.trade_role = trade;
    await saveStore(rows);
    return { ok: true, contact: safe(prev) };
  }
  const row = { id: newId(), owner_id: ownerId, email: e, name: name ?? null, company: company ?? null, trade_role: trade, created_at: now() };
  rows.push(row); await saveStore(rows);
  return { ok: true, contact: safe(row) };
}

/** Update one contact by id (owner-scoped). */
export async function updateContact(ownerId, id, changes = {}) {
  if (changes.tradeRole !== undefined && !validTrade(changes.tradeRole)) return { ok: false, reason: 'invalid', message: 'invalid trade role' };
  const patch = {};
  if (changes.name !== undefined) patch.name = changes.name;
  if (changes.company !== undefined) patch.company = changes.company;
  if (changes.tradeRole !== undefined) patch.trade_role = changes.tradeRole || null;
  if (changes.email !== undefined) {
    const e = normEmail(changes.email);
    if (!e || !/.+@.+\..+/.test(e)) return { ok: false, reason: 'invalid', message: 'a valid email is required' };
    patch.email = e;
  }
  const sb = supa();
  if (sb) {
    const { error } = await sb.from(TABLE).update(patch).eq('owner_id', ownerId).eq('id', id);
    if (error) throw error;
    return { ok: true };
  }
  const rows = await loadStore();
  const r = rows.find((x) => x.owner_id === ownerId && x.id === id);
  if (!r) return { ok: false, reason: 'not_found' };
  Object.assign(r, patch); await saveStore(rows);
  return { ok: true };
}

/** Remove a contact by id (owner-scoped). */
export async function removeContact(ownerId, id) {
  const sb = supa();
  if (sb) { const { error } = await sb.from(TABLE).delete().eq('owner_id', ownerId).eq('id', id); if (error) throw error; return { ok: true }; }
  const rows = await loadStore();
  const next = rows.filter((x) => !(x.owner_id === ownerId && x.id === id));
  if (next.length === rows.length) return { ok: false, reason: 'not_found' };
  await saveStore(next);
  return { ok: true };
}
