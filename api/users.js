// Admin-only user management (AUTH_MODE=users). Create / list / disable accounts.
// No open signup — only an authenticated admin may call these.

import { requireAuth, authCheck } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { createUser, listUsers, setUserDisabled, usersAuthEnabled } from '../lib/users.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

export default async function handler(req, res) {
  if (!(await enforceRateLimit(req, res, { id: 'users', limit: 30, windowMs: 60_000 }))) return;
  if (!requireAuth(req, res).ok) return;

  // Admin only.
  const caller = authCheck(req);
  if (caller.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  if (!usersAuthEnabled()) return res.status(409).json({ error: 'AUTH_MODE is not "users"' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ users: await listUsers() });
    }

    if (req.method === 'POST') {
      const { email, password, name, role } = req.body || {};
      const user = await createUser({ email, password, name, role });
      return res.status(200).json({ ok: true, user });
    }

    if (req.method === 'PATCH') {
      const { id, disabled } = req.body || {};
      if (!id || typeof disabled !== 'boolean') return res.status(400).json({ error: 'id and disabled (boolean) required' });
      const changed = await setUserDisabled(id, disabled);
      if (!changed) return res.status(404).json({ error: 'user not found' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    captureException(error);
    log.error('[api/users] failed', error?.message || error);
    // Surface validation errors (400) but not internal details.
    const msg = error?.message || 'Internal server error';
    const status = /required|already registered|at least|role must/.test(msg) ? 400 : 500;
    return res.status(status).json({ error: status === 400 ? msg : 'Internal server error' });
  }
}
