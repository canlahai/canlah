// Subcontractor / contact directory API (Pro). An owner's reusable address book.
//
//   GET    /api/contacts                     → my contacts
//   POST   { email, name?, company?, tradeRole? }  → add / upsert
//   PATCH  { id, name?, company?, tradeRole?, email? } → update
//   DELETE { id }                            → remove
//
// Owner-scoped (every row is keyed to the caller). Creating a programme is the
// Pro gate elsewhere; the directory is available to any signed-in user (a free
// subcon can keep their own contacts too — harmless and useful).

import { requireAuth, authCheck } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { listContacts, addContact, updateContact, removeContact } from '../lib/contacts.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

const reasonStatus = { not_found: 404, forbidden: 403, invalid: 400 };

export default async function handler(req, res) {
  if (!(await enforceRateLimit(req, res, { id: 'contacts', limit: 60, windowMs: 60_000 }))) return;
  if (!requireAuth(req, res).ok) return;
  const uid = authCheck(req).id;

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ contacts: await listContacts(uid) });
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      const r = await addContact(uid, { email: b.email, name: b.name, company: b.company, tradeRole: b.tradeRole });
      if (!r.ok) return res.status(reasonStatus[r.reason] || 400).json({ error: r.message || r.reason });
      return res.status(200).json({ ok: true, contact: r.contact });
    }
    if (req.method === 'PATCH') {
      const b = req.body || {};
      if (!b.id) return res.status(400).json({ error: 'id required' });
      const r = await updateContact(uid, b.id, b);
      if (!r.ok) return res.status(reasonStatus[r.reason] || 400).json({ error: r.message || r.reason });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'DELETE') {
      const id = (req.body && req.body.id) || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const r = await removeContact(uid, id);
      if (!r.ok) return res.status(reasonStatus[r.reason] || 400).json({ error: r.reason });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    captureException(error);
    log.error('[api/contacts] failed', error?.message || error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
