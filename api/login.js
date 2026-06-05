import { setSessionCookie } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // Strict throttle: the whole app is behind one shared password, so cap
  // login attempts per IP to blunt brute-force.
  if (!enforceRateLimit(req, res, { id: 'login', limit: 10, windowMs: 60_000 })) return;

  try {
    const expected = process.env.ACCESS_PASSWORD;
    if (!expected) return res.status(503).json({ error: 'Access not configured (set ACCESS_PASSWORD)' });

    const body = req.body || {};
    if (!body.password || typeof body.password !== 'string') {
      return res.status(400).json({ error: 'password required' });
    }
    if (body.password !== expected) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const uid = 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const sessionPayload = { role: 'user', id: uid, exp };
    if (name) sessionPayload.name = name;
    res.setHeader('Set-Cookie', setSessionCookie(sessionPayload));
    return res.status(200).json({ ok: true });
  } catch (error) {
    captureException(error);
    log.error('[api/login] login failed', error?.message || error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
