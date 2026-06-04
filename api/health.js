import { getSupabaseConfig, pingSupabase } from '../lib/supabase.js';
import { getSentryStatus } from '../lib/sentry.js';

// GET /api/health        — shallow: reports config presence (fast, always 200).
// GET /api/health?deep=1 — also pings Supabase. If it's supposed to be
//                          configured but is unreachable (deleted/paused project,
//                          bad key), returns 503 status:"degraded" so uptime
//                          monitors alarm instead of the outage hiding behind a
//                          passing shallow check.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let deep = false;
  try {
    deep = new URL(req.url, 'http://localhost').searchParams.get('deep') === '1';
  } catch {
    deep = false;
  }

  let supabase = getSupabaseConfig();
  let degraded = false;
  if (deep) {
    const ping = await pingSupabase();
    supabase = { ...supabase, ...ping };
    if (ping.configured && !ping.reachable) degraded = true;
  }

  return res.status(degraded ? 503 : 200).json({
    status: degraded ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || 'development',
    demoMode: process.env.DEMO_MODE === 'true' || !process.env.BLOB_READ_WRITE_TOKEN,
    blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    supabase,
    sentry: getSentryStatus(),
  });
}
