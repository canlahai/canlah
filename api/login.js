import { setSessionCookie } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { usersAuthEnabled, verifyCredentials } from '../lib/users.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  // Strict throttle to blunt brute-force (shared password or per-user).
  if (!(await enforceRateLimit(req, res, { id: 'login', limit: 10, windowMs: 60_000 }))) return;

  try {
    const body = req.body || {};

    // AUTH_MODE=users: verify email + password against the users table.
    if (usersAuthEnabled()) {
      const { email, password } = body;
      if (!email || !password) return res.status(400).json({ error: 'email and password required' });
      const user = await verifyCredentials(email, password);
      if (!user) return res.status(401).json({ error: 'Invalid email or password' });
      const sessionPayload = { role: user.role || 'user', id: user.id, exp: Date.now() + SEVEN_DAYS };
      if (user.name) sessionPayload.name = user.name;
      res.setHeader('Set-Cookie', setSessionCookie(sessionPayload));
      return res.status(200).json({ ok: true });
    }

    // Default: single shared ACCESS_PASSWORD.
    const expected = process.env.ACCESS_PASSWORD;
    if (!expected) return res.status(503).json({ error: 'Access not configured (set ACCESS_PASSWORD)' });

    if (!body.password || typeof body.password !== 'string') {
      return res.status(400).json({ error: 'password required' });
    }
    if (body.password !== expected) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const uid = 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const sessionPayload = { role: 'user', id: uid, exp: Date.now() + SEVEN_DAYS };
    if (name) sessionPayload.name = name;
    res.setHeader('Set-Cookie', setSessionCookie(sessionPayload));
    return res.status(200).json({ ok: true });
  } catch (error) {
    captureException(error);
    log.error('[api/login] login failed', error?.message || error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
