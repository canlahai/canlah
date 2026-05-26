import { setSessionCookie } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
  res.setHeader('Set-Cookie', setSessionCookie({ role: 'user', exp }));
  return res.status(200).json({ ok: true });
}
