// Shared in-memory rate limiter for the production api/*.js functions.
//
// IMPORTANT — durability caveat: this is an in-process sliding-window counter.
// On Vercel Fluid Compute instances are reused, so it meaningfully throttles a
// single hammering client, but it is NOT a global limiter — counters reset on
// cold start and aren't shared across concurrent instances. For bulletproof
// brute-force protection on login, back this with a durable store (Upstash /
// Supabase). Tracked as a follow-up; this still raises the bar a lot vs none.

const buckets = new Map();
let sweepCounter = 0;

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req) {
  const xff = req?.headers?.['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req?.socket?.remoteAddress || req?.connection?.remoteAddress || 'unknown';
}

/**
 * Record a hit for `key` and report whether it's within the limit.
 * Sliding window: counts hits in the last `windowMs`. Returns
 * { ok, count, limit, remaining, retryAfter }.
 */
export function checkRateLimit(key, { limit = 60, windowMs = 60_000, now = Date.now() } = {}) {
  const recent = (buckets.get(key) || []).filter((ts) => now - ts < windowMs);
  recent.push(now);
  buckets.set(key, recent);

  // Occasional sweep so idle IPs don't accumulate forever.
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

/**
 * Vercel-handler guard. Enforces a per-route, per-IP limit. On breach it writes
 * a 429 (+ Retry-After) and returns false; otherwise returns true. `id` scopes
 * the bucket so e.g. login throttling is independent of analyse throttling.
 */
export function enforceRateLimit(req, res, { id = 'default', limit = 60, windowMs = 60_000 } = {}) {
  const key = `${id}:${clientIp(req)}`;
  const r = checkRateLimit(key, { limit, windowMs });
  if (!r.ok) {
    res.setHeader('Retry-After', String(r.retryAfter));
    res.status(429).json({ error: 'Rate limit exceeded — slow down and try again shortly' });
    return false;
  }
  return true;
}

/** Test-only: clear all buckets. */
export function _resetRateLimitForTests() {
  buckets.clear();
  sweepCounter = 0;
}
