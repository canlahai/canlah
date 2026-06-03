import { requireAuth, getSession } from '../lib/auth.js';
import { saveReport } from '../lib/reports.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res).ok) return;

  try {
    const body = req.body || {};
    if (!body.report) return res.status(400).json({ error: 'report required' });

    const id = 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const savedAt = new Date().toISOString();
    const session = getSession(req) || {};
    const ownerId = session.id;
    const ownerName = session.name || null;
    // Server-controlled fields must win over client input — spread body.report
    // FIRST so a caller can't override id / savedAt / ownerId.
    const report = { ...body.report, id, savedAt, ownerId, ownerName };

    await saveReport(report);
    return res.status(200).json({ ok: true, id: report.id });
  } catch (error) {
    captureException(error);
    log.error('[api/save-report] save failed', error?.message || error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
