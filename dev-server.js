import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createMultipartUpload, uploadPart, completeMultipartUpload } from '@vercel/blob';
import { createClient } from '@supabase/supabase-js';

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve('./');

function loadDotEnv() {
  try {
    const envPath = path.join(ROOT, '.env');
    const raw = readFileSync(envPath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    });
  } catch {
    // ignore missing .env
  }
}

loadDotEnv();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function contentType(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

const DEMO_MODE = (process.env.DEMO_MODE === 'true') || !process.env.BLOB_READ_WRITE_TOKEN;
const DEMO_ROOT = '/tmp/canlah-demo';
const DEMO_FILE_MAP = new Map();
const DATA_DIR = path.join(ROOT, 'data');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');

const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY || '';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const SESSION_MAX_AGE = Number(process.env.SESSION_MAX_AGE_SEC || 60 * 60 * 24);
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_REPORTS_TABLE = process.env.SUPABASE_REPORTS_TABLE || 'canlah_reports';
const SUPABASE = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;
const SESSIONS = new Map();

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (e) {}
}

async function saveReportToSupabase(obj) {
  if (!SUPABASE) throw new Error('Supabase not configured');
  const { data, error } = await SUPABASE
    .from(SUPABASE_REPORTS_TABLE)
    .insert([{ id: obj.id, savedAt: obj.savedAt, report: obj }], { returning: 'representation' });
  if (error) throw error;
  const saved = data?.[0];
  return saved?.report || { id: saved?.id, savedAt: saved?.savedAt, ...saved?.report };
}

async function loadReportsFromSupabase() {
  if (!SUPABASE) throw new Error('Supabase not configured');
  const { data, error } = await SUPABASE
    .from(SUPABASE_REPORTS_TABLE)
    .select('*')
    .order('savedAt', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data.map((row) => row.report || { id: row.id, savedAt: row.savedAt, ...row.report });
}

async function loadReports() {
  if (SUPABASE) {
    try {
      return await loadReportsFromSupabase();
    } catch (e) {
      console.warn('[dev] Supabase load failed, falling back to local JSON:', e.message);
    }
  }

  try {
    await ensureDataDir();
    const raw = await fs.readFile(REPORTS_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
}

async function saveReportObject(obj) {
  if (SUPABASE) {
    try {
      return await saveReportToSupabase(obj);
    } catch (e) {
      console.warn('[dev] Supabase save failed, falling back to local JSON:', e.message);
    }
  }

  const reports = await loadReports();
  reports.unshift(obj);
  try {
    await ensureDataDir();
    await fs.writeFile(REPORTS_FILE, JSON.stringify(reports, null, 2), 'utf8');
  } catch (e) {
    throw e;
  }
  return obj;
}

async function ensureDemoRoot() {
  try {
    await fs.mkdir(DEMO_ROOT, { recursive: true });
  } catch (e) {}
}

// Simple in-memory rate limiter per IP
const RATE_LIMIT_MAP = new Map();
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 60);

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((cookies, part) => {
    const [name, ...rest] = part.split('=');
    if (!name) return cookies;
    cookies[name.trim()] = decodeURIComponent((rest.join('=') || '').trim());
    return cookies;
  }, {});
}

function getRequestApiKey(req) {
  return String(req.headers['x-api-key'] || req.headers['x-admin-key'] || '').trim();
}

function getClientIp(req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  return ip.split(',')[0].trim();
}

function makeSessionToken() {
  return randomBytes(16).toString('hex');
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of SESSIONS.entries()) {
    if (session.expiresAt < now) SESSIONS.delete(token);
  }
}

function getSession(req) {
  cleanupSessions();
  const cookies = parseCookies(req);
  const token = cookies['canlah_session'];
  if (!token) return null;
  const session = SESSIONS.get(token);
  if (!session || session.expiresAt < Date.now()) {
    SESSIONS.delete(token);
    return null;
  }
  return session;
}

function createSession(role) {
  const token = makeSessionToken();
  const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
  SESSIONS.set(token, { role, expiresAt });
  return token;
}

function getSessionCookie(token) {
  return `canlah_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax`;
}

function clearSessionCookie() {
  return 'canlah_session=deleted; HttpOnly; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
}

function checkAdminSessionOrKey(req, res) {
  const session = getSession(req);
  if (session?.role === 'admin') return true;
  if (!ADMIN_API_KEY) return true;
  const key = getRequestApiKey(req);
  if (key && key === ADMIN_API_KEY) return true;
  send(res, 401, JSON.stringify({ error: 'Unauthorized: invalid admin key' }), { 'Content-Type': 'application/json' });
  return false;
}

function checkPublicOrSessionOrAdmin(req, res) {
  const session = getSession(req);
  if (session?.role === 'admin' || session?.role === 'public') return true;
  const key = getRequestApiKey(req);
  if (PUBLIC_API_KEY || ADMIN_API_KEY) {
    if (key && (key === PUBLIC_API_KEY || key === ADMIN_API_KEY)) return true;
    send(res, 401, JSON.stringify({ error: 'Unauthorized: invalid API key' }), { 'Content-Type': 'application/json' });
    return false;
  }
  return true;
}

function rateLimitCheck(req, res) {
  const ip = getClientIp(req);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = RATE_LIMIT_MAP.get(ip) || [];
  const filtered = entry.filter(ts => now - ts < windowMs);
  filtered.push(now);
  RATE_LIMIT_MAP.set(ip, filtered);
  if (filtered.length > RATE_LIMIT_PER_MIN) {
    send(res, 429, JSON.stringify({ error: 'Rate limit exceeded' }), { 'Content-Type': 'application/json' });
    return false;
  }
  return true;
}

async function demoCreateUpload(filename) {
  await ensureDemoRoot();
  const uploadId = `demo-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const dir = path.join(DEMO_ROOT, uploadId);
  await fs.mkdir(dir, { recursive: true });
  const key = `demo/${path.basename(filename)}`;
  return { key, uploadId, dir };
}

async function demoWritePart(uploadId, partNumber, buffer) {
  const dir = path.join(DEMO_ROOT, uploadId);
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, `part-${partNumber}`);
  await fs.writeFile(p, buffer);
  return { etag: `demo-etag-${partNumber}`, partNumber };
}

async function demoComplete(uploadId, parts, filename) {
  const dir = path.join(DEMO_ROOT, uploadId);
  const outPath = path.join(DEMO_ROOT, `${uploadId}-${path.basename(filename)}`);
  const partFiles = (await fs.readdir(dir)).filter(f => f.startsWith('part-'));
  partFiles.sort((a,b)=> Number(a.split('-')[1]) - Number(b.split('-')[1]));
  const out = [];
  for (const pf of partFiles) {
    const buf = await fs.readFile(path.join(dir, pf));
    out.push(buf);
  }
  await fs.writeFile(outPath, Buffer.concat(out));
  const fileId = `demo-file-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  DEMO_FILE_MAP.set(fileId, outPath);
  return { filePath: outPath, fileId };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(body);
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function createSafeBlobKey(filename) {
  const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `uploads/${Date.now()}-${safeName}`;
}

const BLOB_API_BASE_URL =
  process.env.VERCEL_BLOB_API_URL ||
  process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL ||
  'https://blob.vercel-storage.com';

async function uploadPartDirect(key, uploadId, partNumber, buffer, token) {
  const url = `${BLOB_API_BASE_URL}/mpu?pathname=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-mpu-action': 'upload',
      'x-mpu-key': encodeURIComponent(key),
      'x-mpu-upload-id': uploadId,
      'x-mpu-part-number': String(partNumber),
      'content-type': 'application/octet-stream',
    },
    body: buffer,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Vercel Blob upload-part failed: ${text || res.statusText}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { etag: text };
  }
}

async function uploadBufferToBlob(filename, buffer, mimeType) {
  const key = createSafeBlobKey(filename);
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error('Missing BLOB_READ_WRITE_TOKEN environment variable');
  }

  const { key: blobKey, uploadId } = await createMultipartUpload(key, {
    access: 'public',
    contentType: mimeType,
    token: blobToken,
  });

  const part = await uploadPartDirect(blobKey, uploadId, 1, buffer, blobToken);

  return completeMultipartUpload(blobKey, [part], {
    access: 'public',
    uploadId,
    contentType: mimeType,
    token: blobToken,
  });
}

async function handleApi(req, res) {
  if (req.method !== 'POST') {
    return send(res, 405, JSON.stringify({ error: 'Method not allowed' }), { 'Content-Type': 'application/json' });
  }

  const body = await parseBody(req);
  if (body === null) {
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON body' }), { 'Content-Type': 'application/json' });
  }

  const action = (req.headers['x-action'] || body.action || '').toString();

  try {
    if (action === 'upload' || action === 'upload-start' || action === 'upload-part' || action === 'upload-complete') {
      if (action === 'upload') {
        const { fileData, fileName, mimeType } = body;
        if (!fileData || !fileName || !mimeType) {
          throw new Error('fileData, fileName, and mimeType are required');
        }
        const buffer = Buffer.from(fileData, 'base64');
        const blob = await uploadBufferToBlob(fileName, buffer, mimeType);
        return send(res, 200, JSON.stringify({ blobUrl: blob.url }), { 'Content-Type': 'application/json' });
      }

      if (action === 'upload-start') {
        const { filename, mimeType } = body;
        if (!filename) throw new Error('filename required');
        const contentType = mimeType || 'application/pdf';
        if (DEMO_MODE) {
          const { key, uploadId } = await demoCreateUpload(filename);
          console.log('[dev][demo] upload-start created', { key, uploadId });
          return send(res, 200, JSON.stringify({ key, uploadId }), { 'Content-Type': 'application/json' });
        }
        const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
        if (!blobToken) throw new Error('Missing BLOB_READ_WRITE_TOKEN environment variable');
        const { key, uploadId } = await createMultipartUpload(createSafeBlobKey(filename), {
          access: 'public',
          contentType,
          token: blobToken,
        });
        console.log('[dev] upload-start created', { key, uploadId: String(uploadId).slice(0, 60) + '...' });
        return send(res, 200, JSON.stringify({ key, uploadId }), { 'Content-Type': 'application/json' });
      }

      if (action === 'upload-part') {
        const { key, uploadId, partNumber, data, mimeType } = body;
        if (!key || !uploadId || !partNumber || !data) throw new Error('key, uploadId, partNumber, and data are required');
        const contentType = mimeType || 'application/pdf';
        const buffer = Buffer.from(data, 'base64');
        if (DEMO_MODE) {
          const result = await demoWritePart(uploadId, partNumber, buffer);
          console.log('[dev][demo] upload-part incoming', { key, uploadId, partNumber, byteLength: buffer.length });
          return send(res, 200, JSON.stringify(result), { 'Content-Type': 'application/json' });
        }
        const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
        if (!blobToken) throw new Error('Missing BLOB_READ_WRITE_TOKEN environment variable');
        console.log('[dev] upload-part incoming', { key, uploadId: String(uploadId).slice(0,60) + '...', partNumber, byteLength: buffer.length });
        const part = await uploadPartDirect(key, uploadId, partNumber, buffer, blobToken);
        console.log('[dev] upload-part result', { etag: part?.etag, partNumber: part?.partNumber });
        return send(res, 200, JSON.stringify(part), { 'Content-Type': 'application/json' });
      }

      if (action === 'upload-complete') {
        const { key, uploadId, parts, mimeType } = body;
        if (!key || !uploadId || !Array.isArray(parts)) throw new Error('key, uploadId, and parts are required');
        const contentType = mimeType || 'application/pdf';
        if (DEMO_MODE) {
          const { filePath, fileId } = await demoComplete(uploadId, parts, key || 'upload.pdf');
          console.log('[dev][demo] upload-complete assembled', { uploadId, filePath, fileId });
          return send(res, 200, JSON.stringify({ fileId }), { 'Content-Type': 'application/json' });
        }
        const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
        if (!blobToken) throw new Error('Missing BLOB_READ_WRITE_TOKEN environment variable');
        const blob = await completeMultipartUpload(key, parts, {
          access: 'public',
          uploadId,
          contentType,
          token: blobToken,
        });
        const pdfRes = await fetch(blob.url);
        if (!pdfRes.ok) throw new Error(`Failed to fetch blob: ${pdfRes.status}`);
        const pdfBytes = await pdfRes.arrayBuffer();
        const form = new FormData();
        form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'upload.pdf');
        const upRes = await fetch('https://api.anthropic.com/v1/files', {
          method: 'POST',
          headers: {
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'files-api-2025-04-14',
          },
          body: form,
        });
        if (!upRes.ok) throw new Error(`Anthropic upload failed: ${await upRes.text()}`);
        const upData = await upRes.json();
        return send(res, 200, JSON.stringify({ fileId: upData.id }), { 'Content-Type': 'application/json' });
      }
    }

    if (action === 'analyse') {
      const { fileId, blobUrl, prompt, reportType } = body;
      if (!fileId && (!blobUrl || !prompt)) throw new Error('fileId or blobUrl + prompt are required');
      if (DEMO_MODE) {
        if (reportType === 'site-report') {
          const demoSite = {
            siteName: 'Pioneer Road Viaduct — Pier 12',
            reportDate: new Date().toISOString().slice(0, 10),
            weather: 'Partly cloudy, 31°C',
            progressPercent: 65,
            progressNotes: 'Pier formwork 80% complete. Rebar tying in progress on upper section. Ready for concrete pour next week subject to inspection.',
            workersOnSite: 14,
            safetyIssues: [
              'Worker spotted without hard hat near scaffolding (north face)',
              'Loose materials at edge of working platform — fall hazard',
            ],
            issues: [
              { severity: 'high', description: 'Drainage blocked near access road — flooding risk after rain' },
              { severity: 'medium', description: 'Site notice board outdated; current permits not displayed' },
              { severity: 'low', description: 'Material stockpile slightly encroaching on pedestrian walkway' },
            ],
            materialsObserved: ['Rebar bundles', 'Formwork panels', 'Concrete blocks', 'Aggregate'],
            equipmentOnSite: ['Tower crane TC-02', 'Concrete pump', 'Mobile generator', 'Bar bender'],
          };
          return send(res, 200, JSON.stringify({ data: demoSite }), { 'Content-Type': 'application/json' });
        }
        const demoData = {
          projectName: 'Construction of Road Viaduct Along Pioneer Road',
          drawingRef: 'L/RC216/RR/WSCL/0014–0017',
          authority: 'NParks',
          sheets: [
            { sheetNo: '0014', removeCount: 52, retainCount: 89 },
            { sheetNo: '0015', removeCount: 48, retainCount: 92 },
            { sheetNo: '0016', removeCount: 35, retainCount: 78 },
            { sheetNo: '0017', removeCount: 42, retainCount: 81 },
          ],
          trees: [
            { no: 'E0001', girth: 0.3, height: 4.0, species: 'Indian Mango', sheet: '0014', flags: [] },
            { no: 'E0002', girth: 0.6, height: 5.5, species: 'Angsana', sheet: '0014', flags: ['high_conservation'] },
            { no: 'E0003', girth: 1.2, height: 8.0, species: 'Tembusu', sheet: '0014', flags: ['protected', 'high_conservation'] },
            { no: 'E0004', girth: 2.5, height: 12.0, species: 'Senegal Mahogany', sheet: '0014', flags: ['protected', 'high_conservation', 'heritage_candidate'] },
            { no: 'E0005', girth: 0.4, height: 3.5, species: 'Mango', sheet: '0015', flags: [] },
            { no: 'E0006', girth: 1.8, height: 10.0, species: 'African Tulip Tree', sheet: '0015', flags: ['invasive', 'protected'] },
            { no: 'E0007', girth: 0.5, height: 4.2, species: 'Rambutan', sheet: '0015', flags: [] },
            { no: 'E0008', girth: 0.9, height: 6.8, species: 'Mango', sheet: '0016', flags: [] },
            { no: 'E0009', girth: 3.2, height: 18.0, species: 'Rain Tree', sheet: '0016', flags: ['high_conservation', 'heritage_candidate'] },
            { no: 'E0010', girth: 0.2, height: 2.5, species: 'Shrub', sheet: '0017', flags: [] },
            { no: 'E0011', girth: 1.5, height: 9.0, species: 'Angsana', sheet: '0017', flags: ['protected', 'high_conservation'] },
            { no: 'E0012', girth: null, height: 7.0, species: 'Unknown', sheet: '0017', flags: ['missing_data'] },
          ],
          dataIssues: [
            'Tree E0012: Missing girth measurement',
            'Cluster of 3 trees at location E0009: Recorded as single entry',
          ],
          totalRemove: 177,
          totalRetain: 340,
        };
        return send(res, 200, JSON.stringify({ data: demoData }), { 'Content-Type': 'application/json' });
      }
      const content = [];
      if (fileId) {
        content.push({ type: 'document', source: { type: 'file', file_id: fileId } });
      } else {
        content.push({ type: 'document', source: { type: 'url', url: blobUrl } });
      }
      content.push({ type: 'text', text: prompt || '' });
      const msgRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'files-api-2025-04-14',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{ role: 'user', content }],
        }),
      });
      if (!msgRes.ok) {
        const errorText = await msgRes.text();
        throw new Error(errorText);
      }
      const msgData = await msgRes.json();
      if (fileId) {
        const text = msgData.content.filter(b => b.type === 'text').map(b => b.text).join('');
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        return send(res, 200, JSON.stringify({ data: parsed }), { 'Content-Type': 'application/json' });
      }
      return send(res, 200, JSON.stringify(msgData), { 'Content-Type': 'application/json' });
    }

    return send(res, 400, JSON.stringify({ error: `Unknown action: ${action}` }), { 'Content-Type': 'application/json' });
  } catch (err) {
    return send(res, 500, JSON.stringify({ error: err.message || 'Internal server error' }), { 'Content-Type': 'application/json' });
  }
}

async function handleStatic(req, res) {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);
  if (pathname === '/') pathname = '/index.html';

  let filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    return send(res, 403, 'Forbidden');
  }

  try {
    let stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      await fs.access(filePath);
      stat = await fs.stat(filePath);
    }

    const data = await fs.readFile(filePath);
    return send(res, 200, data, { 'Content-Type': contentType(filePath) });
  } catch (err) {
    if (!path.extname(pathname)) {
      const htmlPath = path.join(ROOT, `${pathname}.html`);
      try {
        const htmlData = await fs.readFile(htmlPath);
        return send(res, 200, htmlData, { 'Content-Type': 'text/html; charset=utf-8' });
      } catch (_e) {
        // continue to 404
      }
    }
    send(res, 404, 'Not found');
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  if (parsedUrl.pathname === '/debug-multipart') {
    (async () => {
      try {
        const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
        if (!blobToken) return send(res, 500, JSON.stringify({ error: 'Missing BLOB_READ_WRITE_TOKEN' }), { 'Content-Type': 'application/json' });
        const key = createSafeBlobKey('debug-test.txt');
        console.log('[debug-multipart] creating multipart', { key });
        const { key: blobKey, uploadId } = await createMultipartUpload(key, { access: 'public', contentType: 'text/plain', token: blobToken });
        console.log('[debug-multipart] created', { blobKey, uploadId: String(uploadId).slice(0,60) + '...' });
        const buffer = Buffer.from('Hello debug');
        console.log('[debug-multipart] uploading part', { blobKey, partBytes: buffer.length });
        const part = await uploadPart(blobKey, buffer, { access: 'public', uploadId, partNumber: 1, contentType: 'text/plain', token: blobToken });
        console.log('[debug-multipart] uploaded part', { etag: part?.etag, partNumber: part?.partNumber });
        const blob = await completeMultipartUpload(blobKey, [part], { access: 'public', uploadId, contentType: 'text/plain', token: blobToken });
        console.log('[debug-multipart] completed', { url: blob?.url });
        try {
          const { del } = await import('@vercel/blob');
          await del(blob.url);
        } catch (_e) {}
        return send(res, 200, JSON.stringify({ ok: true, blobUrl: blob.url }), { 'Content-Type': 'application/json' });
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
  }
  if (parsedUrl.pathname === '/api/save-report' && req.method === 'POST') {
    (async () => {
      try {
        if (!rateLimitCheck(req, res)) return;
        const requireAuth = !DEMO_MODE;
        if (requireAuth && !checkAdminSessionOrKey(req, res)) return;
        const body = await parseBody(req);
        if (!body || !body.report) return send(res, 400, JSON.stringify({ error: 'report required' }), { 'Content-Type': 'application/json' });
        const id = 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
        const toSave = Object.assign({ id, savedAt: new Date().toISOString() }, body.report);
        await saveReportObject(toSave);
        return send(res, 200, JSON.stringify({ ok: true, id }), { 'Content-Type': 'application/json' });
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
  }

  if (parsedUrl.pathname === '/api/reports' && req.method === 'GET') {
    (async () => {
      try {
        if (!rateLimitCheck(req, res)) return;
        const requireAuth = !DEMO_MODE;
        if (requireAuth && !checkAdminSessionOrKey(req, res)) return;
        const reports = await loadReports();
        return send(res, 200, JSON.stringify({ reports }), { 'Content-Type': 'application/json' });
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
  }

  if (parsedUrl.pathname === '/api/process') {
    // Protect API actions with rate limiting and optional API key when not in demo mode
    (async () => {
      try {
        if (!rateLimitCheck(req, res)) return;
        if (!DEMO_MODE && !checkPublicOrSessionOrAdmin(req, res)) return;
        return handleApi(req, res);
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
  }
  if (parsedUrl.pathname === '/api/config' && req.method === 'GET') {
    return send(res, 200, JSON.stringify({
      publicApiKey: PUBLIC_API_KEY || null,
      demoMode: DEMO_MODE,
      blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
      anthropicKey: !!process.env.ANTHROPIC_API_KEY,
    }), { 'Content-Type': 'application/json' });
  }

  if (parsedUrl.pathname === '/debug') {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const tokenStatus = token ? `present (${token.substring(0, 20)}...${token.substring(token.length - 10)})` : 'missing';
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const anthropicStatus = anthropicKey ? 'present' : 'missing';
    return send(res, 200, JSON.stringify({ 
      blobToken: !!token,
      anthropicKey: !!anthropicKey,
      BLOB_READ_WRITE_TOKEN: tokenStatus,
      ANTHROPIC_API_KEY: anthropicStatus,
      NODE_ENV: process.env.NODE_ENV || 'development'
    }), { 'Content-Type': 'application/json' });
  }
  return handleStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Dev server running at http://127.0.0.1:${PORT}`);
});
