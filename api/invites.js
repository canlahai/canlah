// Programme invites API (Pro-gated). Email-based, shareable-link delivery.
//
//   POST   { programmeId, email, accessLevel, tradeRole? }  → create (admin) → { invite }
//   POST   { action:'accept', token }                       → accept (signed-in invitee)
//   GET    ?token=...                                        → invite info (accept page)
//   GET    ?programmeId=...                                  → pending invites (admin)
//   DELETE { token }                                         → revoke (admin)

import { requireAuth, authCheck, setSessionCookie } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { getUserById, createUser, usersAuthEnabled } from '../lib/users.js';
import { getProgramme } from '../lib/programmes.js';
import { createInvite, getInvite, listInvites, revokeInvite, acceptInvite } from '../lib/invites.js';

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
// Safe subset of an invite for the (public) accept page — no internal ids.
const publicInvite = (i) => i && { programmeName: i.programmeName, email: i.email, accessLevel: i.accessLevel, tradeRole: i.tradeRole, status: i.status };
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

const reasonStatus = { not_found: 404, forbidden: 403, invalid: 400 };

export default async function handler(req, res) {
  if (!(await enforceRateLimit(req, res, { id: 'invites', limit: 60, windowMs: 60_000 }))) return;

  // ── PUBLIC (no auth) — let an invited person see + accept an invite by
  // creating their own account from the link. The token is the secret. ──
  const params = new URL(req.url, 'http://x').searchParams;
  if (req.method === 'GET' && (req.query?.public || params.get('public'))) {
    const inv = await getInvite(req.query?.token || params.get('token'));
    if (!inv) return res.status(404).json({ error: 'Invite not found' });
    return res.status(200).json({ invite: publicInvite(inv) });
  }
  if (req.method === 'POST' && (req.body || {}).action === 'registerAccept') {
    const body = req.body || {};
    if (!usersAuthEnabled()) return res.status(400).json({ error: 'Self sign-up is not enabled here' });
    const inv = await getInvite(body.token);
    if (!inv || inv.status !== 'pending') return res.status(400).json({ error: 'This invite is not valid, or it has already been used.' });
    if (!body.password || String(body.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    let user;
    try {
      user = await createUser({ email: inv.email, password: body.password, name: (body.name || '').trim() || null, role: 'user' });
    } catch (e) {
      if (/already registered/i.test(e.message || '')) return res.status(409).json({ error: `An account already exists for ${inv.email}. Please sign in to accept.`, code: 'exists' });
      throw e;
    }
    const r = await acceptInvite(body.token, { id: user.id, email: user.email });
    if (!r.ok) return res.status(reasonStatus[r.reason] || 400).json({ error: r.message || r.reason || 'Could not accept the invite' });
    const payload = { role: 'user', id: user.id, exp: Date.now() + SEVEN_DAYS };
    if (user.name) payload.name = user.name;
    res.setHeader('Set-Cookie', setSessionCookie(payload));
    return res.status(200).json({ ok: true, programmeId: r.programmeId, accessLevel: r.accessLevel });
  }

  if (!requireAuth(req, res).ok) return;
  const caller = authCheck(req);
  const uid = caller.id;
  // No blanket Pro gate: invited members (free) must be able to view + accept
  // invites. Creating/listing/revoking invites is admin-only, enforced per
  // programme inside the invites lib (canManage). Accept is email-matched.

  try {
    if (req.method === 'GET') {
      const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      if (q.token) {
        const invite = await getInvite(q.token);
        if (!invite) return res.status(404).json({ error: 'Invite not found' });
        return res.status(200).json({ invite });
      }
      if (q.programmeId) {
        const prog = await getProgramme(q.programmeId, uid);
        if (!prog) return res.status(404).json({ error: 'Programme not found' });
        const r = await listInvites(q.programmeId, prog.access);
        if (!r.ok) return res.status(reasonStatus[r.reason] || 400).json({ error: r.reason });
        return res.status(200).json({ invites: r.invites });
      }
      return res.status(400).json({ error: 'token or programmeId required' });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (body.action === 'accept') {
        const u = await getUserById(uid).catch(() => null);
        const r = await acceptInvite(body.token, { id: uid, email: u?.email });
        if (!r.ok) return res.status(reasonStatus[r.reason] || 400).json({ error: r.message || r.reason });
        return res.status(200).json({ ok: true, programmeId: r.programmeId, accessLevel: r.accessLevel });
      }
      const prog = await getProgramme(body.programmeId, uid);
      if (!prog) return res.status(404).json({ error: 'Programme not found' });
      const r = await createInvite({ programmeId: body.programmeId, actorAccess: prog.access, email: body.email, accessLevel: body.accessLevel, tradeRole: body.tradeRole, invitedBy: uid });
      if (!r.ok) return res.status(reasonStatus[r.reason] || 400).json({ error: r.message || r.reason });
      return res.status(200).json({ ok: true, invite: r.invite });
    }

    if (req.method === 'DELETE') {
      const token = (req.body && req.body.token) || req.query?.token;
      const inv = await getInvite(token);
      if (!inv) return res.status(404).json({ error: 'Invite not found' });
      const prog = await getProgramme(inv.programmeId, uid);
      if (!prog) return res.status(404).json({ error: 'Programme not found' });
      const r = await revokeInvite(token, prog.access);
      if (!r.ok) return res.status(reasonStatus[r.reason] || 400).json({ error: r.reason });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    captureException(error);
    log.error('[api/invites] failed', error?.message || error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
