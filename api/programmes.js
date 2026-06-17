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
  listProgrammesForUser, listPortfolioForUser, getProgramme, createProgramme,
  updateProgramme, updateActivity, setMember, removeMember, deleteProgramme,
} from '../lib/programmes.js';
import { computeSchedule } from '../lib/cpm.js';
import { lookahead, resourceLoad, masterPlan } from '../lib/portfolio.js';
import { listContacts, addContact, updateContact, removeContact } from '../lib/contacts.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

const reasonStatus = { not_found: 404, forbidden: 403, invalid: 400 };

// The subcontractor directory rides on this function (Hobby plan caps deployments
// at 12 serverless functions) — reached via /api/programmes?resource=contacts.
async function handleContacts(req, res, uid) {
  if (req.method === 'GET') return res.status(200).json({ contacts: await listContacts(uid) });
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
}

// Map stored activities to the lib/cpm.js task shape (tolerant of strings from a form).
function normaliseTasks(activities) {
  if (!Array.isArray(activities)) throw new Error('activities must be an array');
  return activities.map((a) => ({
    id: a.id,
    name: a.name,
    durationDays: Math.max(0, Math.round(Number(a.durationDays) || 0)),
    predecessors: (a.predecessors || []).map((p) =>
      (typeof p === 'string' ? { id: p } : { id: p.id, type: p.type, lagDays: Number(p.lagDays) || 0 })),
  }));
}

export default async function handler(req, res) {
  if (!(await enforceRateLimit(req, res, { id: 'programmes', limit: 60, windowMs: 60_000 }))) return;
  if (!requireAuth(req, res).ok) return;

  const caller = authCheck(req);
  const uid = caller.id;
  // Pro is required to CREATE a programme (the main contractor pays). Invited
  // members — viewers/editors/subcontractors — collaborate for free; their access
  // to each programme is enforced per-programme by roleOf() inside the lib.

  try {
    const resource = req.query?.resource || new URL(req.url, 'http://x').searchParams.get('resource');
    if (resource === 'contacts') return await handleContacts(req, res, uid);

    if (req.method === 'GET') {
      const params = new URL(req.url, 'http://x').searchParams;
      const id = req.query?.id || params.get('id');
      if (id) {
        const prog = await getProgramme(id, uid);
        if (!prog) return res.status(404).json({ error: 'Programme not found' });
        return res.status(200).json({ programme: prog });
      }
      const view = req.query?.view || params.get('view');
      if (view === 'portfolio') {
        return res.status(200).json({ programmes: await listPortfolioForUser(uid) });
      }
      if (view === 'lookahead') {
        const days = Math.max(7, Math.min(90, Number(req.query?.days || params.get('days')) || 21));
        return res.status(200).json(await lookahead(uid, { days }));
      }
      if (view === 'resources') {
        return res.status(200).json(await resourceLoad(uid));
      }
      if (view === 'master') {
        return res.status(200).json(await masterPlan(uid));
      }
      return res.status(200).json({ programmes: await listProgrammesForUser(uid) });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      // Stateless critical-path compute (no persistence) — powers the live Gantt.
      if (body.action === 'schedule') {
        try {
          const schedule = computeSchedule(normaliseTasks(body.activities), { startDate: body.startDate });
          return res.status(200).json({ schedule });
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }
      if (!(await hasProAccess(caller))) {
        return res.status(402).json({ error: 'Creating a programme is a Pro feature. Ask your main contractor to invite you, or upgrade to Pro.', code: 'pro_required' });
      }
      const programme = await createProgramme({ name: body.name, ownerId: uid, startDate: body.startDate, endDate: body.endDate, activities: body.activities });
      return res.status(200).json({ ok: true, programme });
    }

    if (req.method === 'PATCH') {
      const body = req.body || {};
      if (!body.id) return res.status(400).json({ error: 'id required' });
      let result;
      if (body.member) result = await setMember(body.id, uid, body.member);
      else if (body.removeMember) result = await removeMember(body.id, uid, body.removeMember);
      else if (body.activityId) result = await updateActivity(body.id, uid, body.activityId, body.patch || {}, body.note);
      else result = await updateProgramme(body.id, uid, body);
      if (!result.ok) {
        return res.status(reasonStatus[result.reason] || 400).json({ error: result.message || result.reason || 'update failed' });
      }
      return res.status(200).json(result.activity ? { ok: true, activity: result.activity } : { ok: true });
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
