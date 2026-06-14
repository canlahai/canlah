// Programme Planner (Pro) API — collaborative construction schedules.
//
//   GET    /api/programmes            → programmes I own or belong to
//   GET    /api/programmes?id=PG      → one programme (activities + members)
//   POST   { name, startDate, activities? }            → create (I become owner/pm)
//   PATCH  { id, name?, startDate?, activities? }       → edit (editor roles)
//   PATCH  { id, member: { userId, role } }             → add/update a member (pm)
//   PATCH  { id, removeMember: userId }                 → remove a member (pm)
//   DELETE { id }                                       → delete (owner only)
//
// Pro-gated: per-user auth requires tier 'pro' (admins always pass); demo and
// shared-auth modes are open.

import { requireAuth, authCheck } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { hasProAccess } from '../lib/users.js';
import {
  listProgrammesForUser, getProgramme, createProgramme,
  updateProgramme, setMember, removeMember, deleteProgramme,
} from '../lib/programmes.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

const reasonStatus = { not_found: 404, forbidden: 403, invalid: 400 };

export default async function handler(req, res) {
  if (!(await enforceRateLimit(req, res, { id: 'programmes', limit: 60, windowMs: 60_000 }))) return;
  if (!requireAuth(req, res).ok) return;

  const caller = authCheck(req);
  if (!(await hasProAccess(caller))) {
    return res.status(403).json({ error: 'Programme Planner is a Pro feature', code: 'pro_required' });
  }
  const uid = caller.id;

  try {
    if (req.method === 'GET') {
      const id = req.query?.id || new URL(req.url, 'http://x').searchParams.get('id');
      if (id) {
        const prog = await getProgramme(id, uid);
        if (!prog) return res.status(404).json({ error: 'Programme not found' });
        return res.status(200).json({ programme: prog });
      }
      return res.status(200).json({ programmes: await listProgrammesForUser(uid) });
    }

    if (req.method === 'POST') {
      const { name, startDate, activities } = req.body || {};
      const programme = await createProgramme({ name, ownerId: uid, startDate, activities });
      return res.status(200).json({ ok: true, programme });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      if (!body.id) return res.status(400).json({ error: 'id required' });
      let result;
      if (body.member) result = await setMember(body.id, uid, body.member);
      else if (body.removeMember) result = await removeMember(body.id, uid, body.removeMember);
      else result = await updateProgramme(body.id, uid, body);
      if (!result.ok) {
        return res.status(reasonStatus[result.reason] || 400).json({ error: result.message || result.reason || 'update failed' });
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = (req.body && req.body.id) || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const result = await deleteProgramme(id, uid);
      if (!result.ok) return res.status(reasonStatus[result.reason] || 400).json({ error: result.reason || 'delete failed' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    captureException(error);
    log.error('[api/programmes] failed', error?.message || error);
    const msg = error?.message || 'Internal server error';
    const status = /required|must be|YYYY-MM-DD/.test(msg) ? 400 : 500;
    return res.status(status).json({ error: status === 400 ? msg : 'Internal server error' });
  }
}
