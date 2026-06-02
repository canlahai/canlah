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
