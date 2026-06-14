// Stateless HMAC-signed session cookies. Used by both api/*.js (Vercel) and
// dev-server.js. No server-side state means it works across function
// instances on serverless without an external store.

import { createHmac, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'canlah_session';
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const s = process.env.SESSION_SECRET || process.env.ACCESS_PASSWORD || '';
  if (!s) throw new Error('SESSION_SECRET or ACCESS_PASSWORD must be set');
  return s;
}

function isDemoMode() {
  return process.env.DEMO_MODE === 'true' || !process.env.BLOB_READ_WRITE_TOKEN;
}

export function sign(payload) {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json).toString('base64url');
  const hmac = createHmac('sha256', getSecret()).update(b64).digest('base64url');
  return `${b64}.${hmac}`;
}

export function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  let expected;
  try {
    expected = createHmac('sha256', getSecret()).update(b64).digest('base64url');
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  if (!header) return {};
  return header.split(';').reduce((acc, part) => {
    const [k, ...rest] = part.split('=');
    if (!k) return acc;
    acc[k.trim()] = decodeURIComponent((rest.join('=') || '').trim());
    return acc;
  }, {});
}

export function getSession(req) {
  const cookies = parseCookies(req.headers?.cookie);
  return verify(cookies[SESSION_COOKIE]);
}

export function setSessionCookie(payload) {
  const token = sign(payload);
  // Secure flag only in production — local dev + tests run over plain HTTP.
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}; SameSite=Lax${secure}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

// Returns { ok, role?, demo?, id? }. Pure — does NOT write to res. Callers write
// their own 401 if !ok. Demo mode bypasses auth so in-repo tests and demo flows
// work without credentials. Admin API key path is preserved for curl debugging.
// `id` carries the session user id (used for per-user quota + programme access).
export function authCheck(req) {
  if (isDemoMode()) return { ok: true, demo: true, id: 'demo-user' };
  const key = String(req.headers?.['x-api-key'] || req.headers?.['x-admin-key'] || '').trim();
  if (key && process.env.ADMIN_API_KEY && key === process.env.ADMIN_API_KEY) {
    return { ok: true, role: 'admin', id: 'admin-key' };
  }
  const session = getSession(req);
  if (session?.role) return { ok: true, role: session.role, id: session.id };
  return { ok: false };
}

// Vercel-style wrapper that writes the 401 response. For api/*.js consumers.
export function requireAuth(req, res) {
  const result = authCheck(req);
  if (!result.ok) res.status(401).json({ error: 'Unauthorized — please log in' });
  return result;
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
