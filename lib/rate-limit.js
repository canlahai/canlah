// Rate limiter for the production api/*.js functions.
//
// Two backends:
//   - in-memory (default): sliding-window counter, per-instance. Fine for a
//     single-firm deployment; not shared across cold starts / concurrent
//     instances on serverless.
//   - durable (opt-in via RATE_LIMIT_DURABLE=true + Supabase configured): an
//     atomic Postgres function counts hits across all instances. Run
//     db/rate-limit.sql once to create the table + function.
//
// Durable failures (table missing, network blip) FALL BACK to the in-memory
// limiter — a Supabase hiccup degrades to per-instance limiting, never locks
// users out and never fails open completely.

import { isSupabaseConfigured, getSupabaseClient } from './supabase.js';

const buckets = new Map();
let sweepCounter = 0;

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req?.socket?.remoteAddress || req?.connection?.remoteAddress || 'unknown';
}

/**
 * In-memory sliding-window check. Records a hit for `key` and reports whether
 * it's within the limit. Returns { ok, count, limit, remaining, retryAfter }.
 */
export function checkRateLimit(key, { limit = 60, windowMs = 60_000, now = Date.now() } = {}) {
  const recent = (buckets.get(key) || []).filter((ts) => now - ts < windowMs);
  recent.push(now);
  buckets.set(key, recent);

  if (++sweepCounter % 500 === 0) {
    for (const [k, arr] of buckets) {
      if (!arr.some((ts) => now - ts < windowMs)) buckets.delete(k);
    }
  }

  const count = recent.length;
  const ok = count <= limit;
  return {
    ok,
    count,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfter: ok ? 0 : Math.ceil(windowMs / 1000),
  };
}

function durableEnabled() {
  return process.env.RATE_LIMIT_DURABLE === 'true' && isSupabaseConfigured();
}

/**
 * Durable check via the `check_rate_limit` Postgres function (atomic across
 * instances). Resolves to true/false; THROWS on any backend error so the caller
 * can fall back to in-memory.
 */
async function checkDurable(key, { limit, windowMs }) {
  const { data, error } = await getSupabaseClient().rpc('check_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: Math.ceil(windowMs / 1000),
  });
  if (error) throw error;
  return data === true;
}

/**
 * Per-route, per-IP rate-limit guard. On breach writes 429 (+ Retry-After) and
 * returns false; otherwise true. `id` scopes the bucket (login throttling is
 * independent of analyse throttling). Async: the durable backend does I/O.
 */
export async function enforceRateLimit(req, res, { id = 'default', limit = 60, windowMs = 60_000 } = {}) {
  const key = `${id}:${clientIp(req)}`;
  let ok;
  if (durableEnabled()) {
    try {
      ok = await checkDurable(key, { limit, windowMs });
    } catch {
      ok = checkRateLimit(key, { limit, windowMs }).ok; // degrade to in-memory
    }
  } else {
    ok = checkRateLimit(key, { limit, windowMs }).ok;
  }
  if (!ok) {
    res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
    res.status(429).json({ error: 'Rate limit exceeded — slow down and try again shortly' });
    return false;
  }
  return true;
}

/** Test-only: clear all in-memory buckets. */
export function _resetRateLimitForTests() {
  buckets.clear();
  sweepCounter = 0;
}
