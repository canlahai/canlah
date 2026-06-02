import { clearSessionCookie } from '../lib/auth.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  } catch (error) {
    captureException(error);
    log.error('[api/logout] logout failed', error?.message || error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
