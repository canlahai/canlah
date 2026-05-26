import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_REPORTS_TABLE = process.env.SUPABASE_REPORTS_TABLE || 'canlah_reports';

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res).ok) return;
  if (!supabase) return res.status(503).json({ error: 'Persistence not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)' });

  const { data, error } = await supabase
    .from(SUPABASE_REPORTS_TABLE)
    .select('*')
    .order('savedAt', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

  const reports = (data || []).map(row => row.report || { id: row.id, savedAt: row.savedAt });
  return res.status(200).json({ reports });
}
