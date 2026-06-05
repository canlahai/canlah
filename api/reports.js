import { requireAuth, authCheck, getSession } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { loadReports, deleteReport, updateReport, getReportsByIds, deleteReports } from '../lib/reports.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

export default async function handler(req, res) {
  try {
    if (!enforceRateLimit(req, res, { id: 'reports', limit: 60, windowMs: 60_000 })) return;
    if (req.method === 'GET') {
      const auth = requireAuth(req, res);
      if (!auth.ok) return;

      // support query params: page, perPage, q, ids
      const page = Number(req.query?.page || 0);
      const perPage = Number(req.query?.perPage || req.query?.per_page || 50);
      const q = req.query?.q || req.query?.q || undefined;
      const idsParam = req.query?.ids;
      if (idsParam) {
        const ids = String(idsParam).split(',').filter(Boolean);
        const items = await getReportsByIds(ids);
        return res.status(200).json({ reports: items });
      }

      const reports = await loadReports({ limit: perPage, offset: page * perPage, q });
      return res.status(200).json({ reports, page, perPage });
    }

    if (req.method === 'POST') {
      const auth = requireAuth(req, res);
      if (!auth.ok) return;
      const body = req.body || {};
      const action = body.action;
      if (action === 'export') {
        const ids = body.ids || [];
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
        const items = await getReportsByIds(ids);
        return res.status(200).json({ reports: items });
      }
      if (action === 'transfer') {
        const id = body.id;
        const toUserId = body.toUserId;
        const toUserName = body.toUserName || null;
        if (!id || !toUserId) return res.status(400).json({ error: 'id and toUserId required' });

        const caller = authCheck(req);
        if (!caller.ok) return res.status(401).json({ error: 'Unauthorized' });
        const session = getSession(req) || {};

        // Only admin or current owner may transfer
        if (caller.role !== 'admin') {
          const items = await getReportsByIds([id]);
          const it = items[0];
          if (!it) return res.status(404).json({ error: 'not found' });
          if (it.ownerId && it.ownerId !== session.id) return res.status(403).json({ error: 'Forbidden — cannot transfer someone else\'s report' });
        }

        // Record transfer metadata
        const prev = (await getReportsByIds([id]))[0] || {};
        const changes = {
          ownerId: toUserId,
          ownerName: toUserName || null,
          previousOwnerId: prev.ownerId || null,
          previousOwnerName: prev.ownerName || null,
          transferredAt: new Date().toISOString(),
          transferredBy: session.id || null,
        };
        await updateReport(id, changes);
        return res.status(200).json({ ok: true });
      }
      if (action === 'bulk-delete') {
        const ids = body.ids || [];
        if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });

        const caller = authCheck(req);
        if (!caller.ok) return res.status(401).json({ error: 'Unauthorized' });
        const session = getSession(req) || {};

        if (caller.role !== 'admin') {
          const items = await getReportsByIds(ids);
          const notOwned = items.filter((it) => it.ownerId && it.ownerId !== session.id);
          if (notOwned.length > 0) return res.status(403).json({ error: 'Forbidden — cannot delete reports you do not own' });
        }

        await deleteReports(ids);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'unknown action' });
    }

    if (req.method === 'DELETE') {
      const auth = requireAuth(req, res);
      if (!auth.ok) return;
      const body = req.body || {};
      const id = body.id || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });

      const caller = authCheck(req);
      if (!caller.ok) return res.status(401).json({ error: 'Unauthorized' });
      const session = getSession(req) || {};

      if (caller.role !== 'admin') {
        const items = await getReportsByIds([id]);
        const it = items[0];
        if (!it) return res.status(404).json({ error: 'not found' });
        if (it.ownerId && it.ownerId !== session.id) return res.status(403).json({ error: 'Forbidden — cannot delete someone else\'s report' });
      }

      await deleteReport(id);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      const auth = requireAuth(req, res);
      if (!auth.ok) return;
      const body = req.body || {};
      const id = body.id || req.query?.id;
      const changes = body.changes;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (!changes || typeof changes !== 'object') return res.status(400).json({ error: 'changes required' });

      const caller = authCheck(req);
      if (!caller.ok) return res.status(401).json({ error: 'Unauthorized' });
      const session = getSession(req) || {};

      if (caller.role !== 'admin') {
        const items = await getReportsByIds([id]);
        const it = items[0];
        if (!it) return res.status(404).json({ error: 'not found' });
        if (it.ownerId && it.ownerId !== session.id) return res.status(403).json({ error: 'Forbidden — cannot update someone else\'s report' });
      }

      await updateReport(id, changes);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    captureException(error);
    log.error('[api/reports] unexpected error', error?.message || error);
    return res.status(500).json({ error: String(error?.message || error) });
  }
}
