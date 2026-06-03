import { getSupabaseConfig } from '../lib/supabase.js';
import { getSentryStatus } from '../lib/sentry.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  return res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || 'development',
    demoMode: process.env.DEMO_MODE === 'true' || !process.env.BLOB_READ_WRITE_TOKEN,
    blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    supabase: getSupabaseConfig(),
    sentry: getSentryStatus(),
  });
}
