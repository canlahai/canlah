import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_REPORTS_TABLE = process.env.SUPABASE_REPORTS_TABLE || 'canlah_reports';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res).ok) return;
  if (!supabase) return res.status(503).json({ error: 'Persistence not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)' });

  const body = req.body || {};
  if (!body.report) return res.status(400).json({ error: 'report required' });

  const id = 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const savedAt = new Date().toISOString();
  const row = { id, savedAt, report: { id, savedAt, ...body.report } };

  const { error } = await supabase.from(SUPABASE_REPORTS_TABLE).insert([row]);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true, id });
}
