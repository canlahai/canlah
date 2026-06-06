import { authCheck, getSession } from '../lib/auth.js';
import { getSupabaseConfig } from '../lib/supabase.js';
import { usersAuthEnabled } from '../lib/users.js';
import { getSentryStatus } from '../lib/sentry.js';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const demoMode = process.env.DEMO_MODE === 'true' || !process.env.BLOB_READ_WRITE_TOKEN;
  const caller = authCheck(req);
  const session = getSession(req) || null;
  return res.status(200).json({
    publicApiKey: process.env.PUBLIC_API_KEY || null,
    demoMode,
    authMode: usersAuthEnabled() ? 'users' : 'shared',
    blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    supabase: getSupabaseConfig(),
    sentry: getSentryStatus(),
    session: session ? { id: session.id, role: session.role } : null,
    caller: caller.ok ? (caller.role || (caller.demo ? 'demo' : 'user')) : null,
  });
}
