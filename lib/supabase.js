import { createClient } from '@supabase/supabase-js';

let cachedClient = null;

export function getSupabaseUrl() {
  return String(process.env.SUPABASE_URL || '').trim();
}

export function getSupabaseServiceKey() {
  return String(process.env.SUPABASE_SERVICE_KEY || '').trim();
}

export function getSupabaseTable() {
  return String(process.env.SUPABASE_REPORTS_TABLE || 'canlah_reports').trim();
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseServiceKey());
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }
  if (!cachedClient) {
    cachedClient = createClient(getSupabaseUrl(), getSupabaseServiceKey(), {
      auth: { autoRefreshToken: false },
    });
  }
  return cachedClient;
}

export function getSupabaseConfig() {
  return {
    configured: isSupabaseConfigured(),
    table: getSupabaseTable(),
  };
}

// Test-only: drop the memoised client so a later env change takes effect.
export function _resetSupabaseClientForTests() {
  cachedClient = null;
}

function withTimeout(thenable, ms) {
  return Promise.race([
    Promise.resolve(thenable),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

/**
 * Liveness check for the Supabase backend. "configured" only means the env vars
 * are present; this actually runs a cheap query so a deleted/paused project or
 * a bad key surfaces as reachable:false instead of hiding until a user save
 * fails. Never throws — always returns a structured result.
 */
export async function pingSupabase({ timeoutMs = 4000 } = {}) {
  if (!isSupabaseConfigured()) {
    return { configured: false, reachable: false };
  }
  const table = getSupabaseTable();
  const started = Date.now();
  try {
    const client = getSupabaseClient();
    const { error } = await withTimeout(client.from(table).select('id').limit(1), timeoutMs);
    const latencyMs = Date.now() - started;
    if (error) {
      return { configured: true, reachable: false, latencyMs, error: error.message || String(error) };
    }
    return { configured: true, reachable: true, latencyMs };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      latencyMs: Date.now() - started,
      error: err?.message || String(err),
    };
  }
}
