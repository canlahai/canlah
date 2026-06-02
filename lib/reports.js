import fs from 'node:fs/promises';
import path from 'node:path';
import * as log from './log.js';
import { getSupabaseClient, getSupabaseTable, isSupabaseConfigured } from './supabase.js';

const ROOT = path.resolve('./');
const DATA_DIR = process.env.DEV_REPORTS_DIR || path.join(ROOT, 'data');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function getSupabase() {
  return isSupabaseConfigured() ? getSupabaseClient() : null;
}

function getReportsTable() {
  return getSupabaseTable();
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadReportsFromFile(opts = {}) {
  const { limit = 50, offset = 0, q } = opts || {};
  try {
    await ensureDataDir();
    const raw = await fs.readFile(REPORTS_FILE, 'utf8');
    const all = JSON.parse(raw || '[]');
    let list = Array.isArray(all) ? all.slice().sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt)) : [];
    if (q && typeof q === 'string') {
      const ql = q.toLowerCase();
      list = list.filter((r) => {
        const fields = [r.reportTitle, r.projectName, r.siteName, r.companyName, r.drawingRef, r.documentRef].join(' ');
        return String(fields || '').toLowerCase().includes(ql);
      });
    }
    return list.slice(offset, offset + limit);
  } catch (err) {
    return [];
  }
}

async function saveReportsToFile(reports) {
  await ensureDataDir();
  await fs.writeFile(REPORTS_FILE, JSON.stringify(reports, null, 2), 'utf8');
}

async function deleteReportFromFile(id) {
  const reports = await loadReportsFromFile();
  const filtered = reports.filter((report) => report.id !== id);
  if (filtered.length === reports.length) return false;
  await saveReportsToFile(filtered);
  return true;
}

async function deleteReportFromSupabase(id) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');
  const table = getReportsTable();
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}

export async function deleteReport(id) {
  if (!id) throw new Error('id required');

  const supabase = getSupabase();
  if (supabase) {
    try {
      return await deleteReportFromSupabase(id);
    } catch (err) {
      if (IS_PRODUCTION) {
        throw new Error('Persistence delete failed');
      }
      log.warn('[reports] Supabase delete failed, falling back to local JSON:', err.message);
    }
  }

  if (IS_PRODUCTION) {
    throw new Error('Persistence not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  }

  return await deleteReportFromFile(id);
}

async function updateReportInFile(id, changes) {
  const reports = await loadReportsFromFile();
  const index = reports.findIndex((report) => report.id === id);
  if (index === -1) throw new Error('Report not found');
  reports[index] = { ...reports[index], ...changes };
  await saveReportsToFile(reports);
  return reports[index];
}

async function updateReportInSupabase(id, changes) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');
  const table = getReportsTable();
  const { data: existing, error: selectError } = await supabase
    .from(table)
    .select('report')
    .eq('id', id)
    .single();
  if (selectError) throw selectError;
  const merged = { ...(existing?.report || {}), ...changes };
  const { data, error } = await supabase
    .from(table)
    .update({ report: merged })
    .eq('id', id)
    .single();
  if (error) throw error;
  return merged;
}

export async function updateReport(id, changes) {
  if (!id) throw new Error('id required');
  if (!changes || typeof changes !== 'object') throw new Error('changes required');

  const supabase = getSupabase();
  if (supabase) {
    try {
      return await updateReportInSupabase(id, changes);
    } catch (err) {
      if (IS_PRODUCTION) {
        throw new Error('Persistence update failed');
      }
      log.warn('[reports] Supabase update failed, falling back to local JSON:', err.message);
    }
  }

  if (IS_PRODUCTION) {
    throw new Error('Persistence not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  }

  return await updateReportInFile(id, changes);
}

async function saveReportToSupabase(obj) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');
  const table = getReportsTable();
  const { data, error } = await supabase
    .from(table)
    .insert([{ id: obj.id, savedAt: obj.savedAt, report: obj }], { returning: 'representation' });
  if (error) throw error;
  const saved = data?.[0];
  return saved?.report || { id: saved?.id, savedAt: saved?.savedAt, ...saved?.report };
}

async function loadReportsFromSupabase(opts = {}) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');
  const table = getReportsTable();
  const { limit = 50, offset = 0, q } = opts || {};
  const from = offset;
  const to = offset + limit - 1;
  let query = supabase
    .from(table)
    .select('*')
    .order('savedAt', { ascending: false })
    .range(from, to);

  const { data, error } = await query;
  if (error) throw error;
  let rows = (data || []).map((row) => row.report || { id: row.id, savedAt: row.savedAt, ...row.report });
  if (q && typeof q === 'string') {
    const ql = q.toLowerCase();
    rows = rows.filter((r) => {
      const fields = [r.reportTitle, r.projectName, r.siteName, r.companyName, r.drawingRef, r.documentRef].join(' ');
      return String(fields || '').toLowerCase().includes(ql);
    });
  }
  return rows;
}

export async function loadReports(opts = {}) {
  const { limit = 50, offset = 0, q } = opts || {};
  const supabase = getSupabase();
  if (supabase) {
    try {
      return await loadReportsFromSupabase({ limit, offset, q });
    } catch (err) {
      if (IS_PRODUCTION) {
        throw new Error('Persistence load failed');
      }
      log.warn('[reports] Supabase load failed, falling back to local JSON:', err.message);
    }
  }

  if (IS_PRODUCTION) {
    throw new Error('Persistence not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  }

  return await loadReportsFromFile({ limit, offset, q });
}

export async function getReportsByIds(ids = []) {
  if (!Array.isArray(ids)) throw new Error('ids must be an array');
  const supabase = getSupabase();
  if (supabase) {
    try {
      const table = getReportsTable();
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .in('id', ids);
      if (error) throw error;
      return (data || []).map((row) => row.report || { id: row.id, savedAt: row.savedAt, ...row.report });
    } catch (err) {
      if (IS_PRODUCTION) throw err;
      log.warn('[reports] Supabase getByIds failed, falling back to file:', err.message);
    }
  }

  const reports = await loadReportsFromFile();
  return reports.filter((r) => ids.includes(r.id));
}

export async function deleteReports(ids = []) {
  if (!Array.isArray(ids)) throw new Error('ids must be an array');
  const supabase = getSupabase();
  if (supabase) {
    try {
      const table = getReportsTable();
      const { error } = await supabase
        .from(table)
        .delete()
        .in('id', ids);
      if (error) throw error;
      return true;
    } catch (err) {
      if (IS_PRODUCTION) throw new Error('Persistence bulk delete failed');
      log.warn('[reports] Supabase bulk delete failed, falling back to file:', err.message);
    }
  }

  if (IS_PRODUCTION) {
    throw new Error('Persistence not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  }

  const reports = await loadReportsFromFile();
  const filtered = reports.filter((r) => !ids.includes(r.id));
  await saveReportsToFile(filtered);
  return true;
}

export async function saveReport(report) {
  if (!report || typeof report !== 'object') {
    throw new Error('report must be an object');
  }

  const supabase = getSupabase();
  if (supabase) {
    try {
      return await saveReportToSupabase(report);
    } catch (err) {
      if (IS_PRODUCTION) {
        throw new Error('Persistence save failed');
      }
      log.warn('[reports] Supabase save failed, falling back to local JSON:', err.message);
    }
  }

  if (IS_PRODUCTION) {
    throw new Error('Persistence not configured (set SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  }

  const reports = await loadReportsFromFile();
  reports.unshift(report);
  await saveReportsToFile(reports);
  return report;
}
