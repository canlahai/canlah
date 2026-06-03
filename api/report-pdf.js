import { requireAuth, authCheck, getSession } from '../lib/auth.js';
import { getReportsByIds } from '../lib/reports.js';
import { generateReportPdf } from '../lib/pdf.js';
import { initSentry, captureException } from '../lib/sentry.js';

initSentry();

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = requireAuth(req, res);
  if (!auth.ok) return;

  const id = req.query?.id;
  if (!id) return res.status(400).json({ error: 'id required' });

  const caller = authCheck(req);
  if (!caller.ok) return res.status(401).json({ error: 'Unauthorized' });
  const session = getSession(req) || {};

  const items = await getReportsByIds([id]);
  const report = items[0];
  if (!report) return res.status(404).json({ error: 'Report not found' });

  if (caller.role !== 'admin') {
    if (report.ownerId && report.ownerId !== session.id) {
      return res.status(403).json({ error: 'Forbidden — cannot export someone else\'s report' });
    }
  }

  const title = report.reportTitle || report.projectName || report.siteName || report.companyName || 'CanLah Report';
  const filename = `${title.replace(/[^a-zA-Z0-9-_]/g, '_')}-${report.id}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  try {
    await generateReportPdf(report, res);
  } catch (err) {
    captureException(err);
    return res.status(500).json({ error: err.message });
  }
}
