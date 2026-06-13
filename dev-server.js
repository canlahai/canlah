
import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// PDF generation moved to lib/pdf.js
import { createMultipartUpload, uploadPart, completeMultipartUpload } from '@vercel/blob';
import { handleUpload } from '@vercel/blob/client';
import { PROMPTS } from './api/process.js';
import { authCheck, getSession, setSessionCookie, clearSessionCookie } from './lib/auth.js';
import { usersAuthEnabled, verifyCredentials, createUser, listUsers, setUserDisabled } from './lib/users.js';
import { getSupabaseConfig, pingSupabase } from './lib/supabase.js';
import { isAllowedBlobUrl } from './lib/blob-url.js';
import { getSentryStatus } from './lib/sentry.js';
import { loadReports, saveReport, deleteReport, updateReport, getReportsByIds } from './lib/reports.js';
import { initSentry, captureException } from './lib/sentry.js';
import * as log from './lib/log.js';

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

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  log.warn('Supabase not configured; running in local JSON mode');
}
if (!process.env.BLOB_READ_WRITE_TOKEN) {
  log.warn('BLOB_READ_WRITE_TOKEN not set; demo upload mode active');
}
}

loadDotEnv();

const SENTRY_ENABLED = initSentry();
if (SENTRY_ENABLED) {
  log.info('Sentry initialized');
}

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err);
  captureException(err);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason);
  captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

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

const PUBLIC_API_KEY = process.env.PUBLIC_API_KEY || '';

async function ensureDemoRoot() {
  try {
    await fs.mkdir(DEMO_ROOT, { recursive: true });
  } catch (e) {}
}

// Simple in-memory rate limiter per IP
const RATE_LIMIT_MAP = new Map();
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 60);

function getClientIp(req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  return ip.split(',')[0].trim();
}

function requireAuthDev(req, res) {
  const result = authCheck(req);
  if (!result.ok) {
    send(res, 401, JSON.stringify({ error: 'Unauthorized — please log in' }), { 'Content-Type': 'application/json' });
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
  const method = res?.req?.method || 'UNKNOWN';
  const url = res?.req?.url || 'UNKNOWN';
  if (status >= 500) {
    log.error(`[http] ${method} ${url} ${status}`, body);
  } else {
    log.info(`[http] ${method} ${url} ${status}`);
  }
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

    // Hand a browser-uploaded Blob to Anthropic Files → fileId (large-file path).
    if (action === 'ingest') {
      const { blobUrl } = body;
      if (!blobUrl) throw new Error('blobUrl required');
      if (DEMO_MODE) return send(res, 200, JSON.stringify({ fileId: 'demo-file' }), { 'Content-Type': 'application/json' });
      if (!isAllowedBlobUrl(blobUrl)) return send(res, 400, JSON.stringify({ error: 'blobUrl must be a Vercel Blob URL' }), { 'Content-Type': 'application/json' });
      const fileRes = await fetch(blobUrl);
      if (!fileRes.ok) throw new Error(`Failed to fetch blob: ${fileRes.status}`);
      const bytes = await fileRes.arrayBuffer();
      const contentType = fileRes.headers.get('content-type') || 'application/pdf';
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: contentType }), 'upload');
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
      try { const { del } = await import('@vercel/blob'); await del(blobUrl); } catch (_) {}
      return send(res, 200, JSON.stringify({ fileId: upData.id }), { 'Content-Type': 'application/json' });
    }

    if (action === 'analyse') {
      const { fileId, blobUrl, prompt, reportType } = body;
      if (DEMO_MODE) {
        if (reportType === 'programme-plan') {
          const demoProg = {
            projectName: 'Construction of HDB EW2 Connection — Blk 102',
            projectRef: 'HDB/PUB/EW2/2026',
            startDate: '2026-06-01',
            endDate: '2027-09-15',
            totalDurationDays: 471,
            phases: [
              { id: 'p1', name: 'Mobilisation', color: 'amber' },
              { id: 'p2', name: 'Piling & Substructure', color: 'orange' },
              { id: 'p3', name: 'Superstructure', color: 'yellow' },
              { id: 'p4', name: 'MEP & Finishes', color: 'green' },
              { id: 'p5', name: 'Handover', color: 'blue' },
            ],
            tasks: [
              { id: 't1', name: 'Site set-up', phaseId: 'p1', start: '2026-06-01', end: '2026-06-30', onCriticalPath: true },
              { id: 't2', name: 'Hoarding & site office', phaseId: 'p1', start: '2026-06-15', end: '2026-07-10', onCriticalPath: false },
              { id: 't3', name: 'Bored piling', phaseId: 'p2', start: '2026-07-01', end: '2026-09-30', onCriticalPath: true },
              { id: 't4', name: 'Pile caps & ground beams', phaseId: 'p2', start: '2026-09-15', end: '2026-11-15', onCriticalPath: true },
              { id: 't5', name: 'Basement slab', phaseId: 'p2', start: '2026-11-01', end: '2026-12-15', onCriticalPath: true },
              { id: 't6', name: 'Tower crane erection', phaseId: 'p3', start: '2026-12-01', end: '2026-12-20', onCriticalPath: false },
              { id: 't7', name: 'Superstructure (L1-L9)', phaseId: 'p3', start: '2026-12-15', end: '2027-04-30', onCriticalPath: true },
              { id: 't8', name: 'Superstructure (L10-L18)', phaseId: 'p3', start: '2027-04-15', end: '2027-07-15', onCriticalPath: true },
              { id: 't9', name: 'MEP rough-in', phaseId: 'p4', start: '2027-03-01', end: '2027-07-30', onCriticalPath: false },
              { id: 't10', name: 'Architectural finishes', phaseId: 'p4', start: '2027-05-01', end: '2027-08-15', onCriticalPath: true },
              { id: 't11', name: 'T&C and pre-handover', phaseId: 'p5', start: '2027-08-01', end: '2027-09-01', onCriticalPath: true },
              { id: 't12', name: 'TOP & handover', phaseId: 'p5', start: '2027-09-01', end: '2027-09-15', onCriticalPath: true },
            ],
            milestones: [
              { id: 'm1', name: 'Piling complete', date: '2026-09-30' },
              { id: 'm2', name: 'Substructure complete', date: '2026-12-15' },
              { id: 'm3', name: 'Top-out', date: '2027-07-15' },
              { id: 'm4', name: 'TOP', date: '2027-09-15' },
            ],
            criticalPathTaskIds: ['t1', 't3', 't4', 't5', 't7', 't8', 't10', 't11', 't12'],
          };
          return send(res, 200, JSON.stringify({ data: demoProg }), { 'Content-Type': 'application/json' });
        }
        if (reportType === 'hr-compliance') {
          const demoHr = {
            companyName: 'Acme Construction Pte Ltd',
            documentRef: 'Q1 2026 Worker Registry',
            totalWorkers: 87,
            byPermitType: { 'Work Permit': 65, 'S Pass': 18, 'Employment Pass': 4 },
            expiringPermits: [
              { workerId: 'W0023', name: 'Kumar S/O Raja', permitType: 'Work Permit', expiryDate: '2026-06-14', daysUntilExpiry: 19 },
              { workerId: 'W0041', name: 'Rahman bin Ismail', permitType: 'Work Permit', expiryDate: '2026-06-22', daysUntilExpiry: 27 },
              { workerId: 'W0058', name: 'Lakshmi Devi', permitType: 'S Pass', expiryDate: '2026-07-10', daysUntilExpiry: 45 },
            ],
            missingCertifications: [
              { workerId: 'W0045', name: 'Ahmad bin Hassan', missing: ['CSOC'] },
              { workerId: 'W0067', name: 'Ravi Kumar', missing: ['CSOC', 'CSCS refresher'] },
            ],
            drcStatus: { current: '1:7.2', limit: '1:7', compliant: false },
            complianceIssues: [
              { severity: 'high', description: 'Dependency Ratio Ceiling exceeded — current 1:7.2 vs limit 1:7 for construction sector' },
              { severity: 'medium', description: '3 workers without current Safety Orientation refresher in past 12 months' },
              { severity: 'low', description: 'Worker register last updated 14 days ago — recommend weekly refresh' },
            ],
          };
          return send(res, 200, JSON.stringify({ data: demoHr }), { 'Content-Type': 'application/json' });
        }
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
        if (reportType === 'traffic') {
          const hours = Array.from({ length: 24 }, (_, h) => {
            const peak = (h >= 7 && h <= 9) || (h >= 17 && h <= 19);
            const mid = h >= 10 && h <= 16;
            const base = peak ? 1500 : mid ? 850 : h < 6 ? 120 : 400;
            return { hour: String(h).padStart(2, '0') + ':00', volume: base + Math.round(Math.sin(h) * 60) };
          });
          const mk = (id, name, road, dir, lanes, mult) => {
            const hourly = hours.map((x) => ({ hour: x.hour, volume: Math.round(x.volume * mult) }));
            const daily = hourly.reduce((s, x) => s + x.volume, 0);
            const pk = hourly.reduce((a, b) => (b.volume > a.volume ? b : a));
            return { locationId: id, locationName: name, roadName: road, direction: dir, lanes, dailyTotal: daily, peakHour: pk.hour, peakVolume: pk.volume, hourlyData: hourly };
          };
          const locations = [
            mk('C1', 'Pioneer Rd / Jln Ahmad Jct', 'Pioneer Road', 'Northbound', 3, 1.0),
            mk('C2', 'Pioneer Rd / Jln Ahmad Jct', 'Pioneer Road', 'Southbound', 3, 0.9),
            mk('C3', 'Jurong West Ave 5', 'Jurong West Ave 5', 'Eastbound', 2, 0.6),
          ];
          const demoTraffic = {
            reportTitle: 'Traffic Impact Assessment — Pioneer Road Viaduct',
            reportDate: new Date().toISOString().slice(0, 10),
            summary: { totalLocations: locations.length, totalVehicles: locations.reduce((s, l) => s + l.dailyTotal, 0) },
            locations,
          };
          return send(res, 200, JSON.stringify({ data: demoTraffic }), { 'Content-Type': 'application/json' });
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
      if (!fileId && !blobUrl) throw new Error('fileId or blobUrl is required');
      // Parity with api/process.js: only analyse documents on our own Blob.
      if (!fileId && !isAllowedBlobUrl(blobUrl)) {
        return send(res, 400, JSON.stringify({ error: 'blobUrl must be a Vercel Blob URL' }), { 'Content-Type': 'application/json' });
      }
      const content = [];
      if (fileId) {
        content.push({ type: 'document', source: { type: 'file', file_id: fileId } });
      } else {
        content.push({ type: 'document', source: { type: 'url', url: blobUrl } });
      }
      content.push({ type: 'text', text: prompt || PROMPTS[reportType] || '' });
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
  } catch (err) {    captureException(err);    return send(res, 500, JSON.stringify({ error: err.message || 'Internal server error' }), { 'Content-Type': 'application/json' });
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
  if (parsedUrl.pathname === '/api/login' && req.method === 'POST') {
    (async () => {
      try {
        if (!rateLimitCheck(req, res)) return;
        const body = await parseBody(req);
        const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;

        // AUTH_MODE=users: verify email + password against the users store.
        if (usersAuthEnabled()) {
          if (!body || !body.email || !body.password) return send(res, 400, JSON.stringify({ error: 'email and password required' }), { 'Content-Type': 'application/json' });
          const user = await verifyCredentials(body.email, body.password);
          if (!user) return send(res, 401, JSON.stringify({ error: 'Invalid email or password' }), { 'Content-Type': 'application/json' });
          const payload = { role: user.role || 'user', id: user.id, exp };
          if (user.name) payload.name = user.name;
          return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json', 'Set-Cookie': setSessionCookie(payload) });
        }

        const expected = process.env.ACCESS_PASSWORD;
        if (!expected) return send(res, 503, JSON.stringify({ error: 'Access not configured (set ACCESS_PASSWORD)' }), { 'Content-Type': 'application/json' });
        if (!body || typeof body.password !== 'string') return send(res, 400, JSON.stringify({ error: 'password required' }), { 'Content-Type': 'application/json' });
        if (body.password !== expected) return send(res, 401, JSON.stringify({ error: 'Invalid password' }), { 'Content-Type': 'application/json' });
        const id = 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const payload = { role: 'user', id, exp };
        if (name) payload.name = name;
        return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json', 'Set-Cookie': setSessionCookie(payload) });
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
  }

  if (parsedUrl.pathname === '/api/users') {
    (async () => {
      try {
        if (!rateLimitCheck(req, res)) return;
        if (!requireAuthDev(req, res)) return;
        const caller = authCheck(req);
        if (caller.role !== 'admin') return send(res, 403, JSON.stringify({ error: 'Admin only' }), { 'Content-Type': 'application/json' });
        if (!usersAuthEnabled()) return send(res, 409, JSON.stringify({ error: 'AUTH_MODE is not "users"' }), { 'Content-Type': 'application/json' });
        if (req.method === 'GET') {
          return send(res, 200, JSON.stringify({ users: await listUsers() }), { 'Content-Type': 'application/json' });
        }
        if (req.method === 'POST') {
          const body = await parseBody(req) || {};
          const user = await createUser(body);
          return send(res, 200, JSON.stringify({ ok: true, user }), { 'Content-Type': 'application/json' });
        }
        if (req.method === 'PATCH') {
          const body = await parseBody(req) || {};
          if (!body.id || typeof body.disabled !== 'boolean') return send(res, 400, JSON.stringify({ error: 'id and disabled (boolean) required' }), { 'Content-Type': 'application/json' });
          const changed = await setUserDisabled(body.id, body.disabled);
          if (!changed) return send(res, 404, JSON.stringify({ error: 'user not found' }), { 'Content-Type': 'application/json' });
          return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
        }
        return send(res, 405, JSON.stringify({ error: 'Method not allowed' }), { 'Content-Type': 'application/json' });
      } catch (err) {
        const msg = err?.message || 'Internal server error';
        const status = /required|already registered|at least|role must/.test(msg) ? 400 : 500;
        return send(res, status, JSON.stringify({ error: status === 400 ? msg : 'Internal server error' }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
  }

  if (parsedUrl.pathname === '/api/logout' && req.method === 'POST') {
    return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie() });
  }

  if (parsedUrl.pathname === '/api/save-report' && req.method === 'POST') {
    (async () => {
      try {
        if (!rateLimitCheck(req, res)) return;
        if (!requireAuthDev(req, res)) return;
        const body = await parseBody(req);
        if (!body || !body.report) return send(res, 400, JSON.stringify({ error: 'report required' }), { 'Content-Type': 'application/json' });
        const id = 'r-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
        const session = getSession(req) || {};
        const ownerId = session.id || null;
        const ownerName = session.name || null;
        const toSave = Object.assign({ id, savedAt: new Date().toISOString(), ownerId, ownerName }, body.report);
        await saveReport(toSave);
        return send(res, 200, JSON.stringify({ ok: true, id }), { 'Content-Type': 'application/json' });
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
  }

  if (parsedUrl.pathname === '/api/reports') {
    (async () => {
      try {
        if (!rateLimitCheck(req, res)) return;
        if (!requireAuthDev(req, res)) return;

        if (req.method === 'GET') {
          const idsParam = parsedUrl.searchParams.get('ids');
          if (idsParam) {
            const ids = String(idsParam).split(',').filter(Boolean);
            const items = await getReportsByIds(ids);
            return send(res, 200, JSON.stringify({ reports: items }), { 'Content-Type': 'application/json' });
          }
          const page = Number(parsedUrl.searchParams.get('page') || 0);
          const perPage = Number(parsedUrl.searchParams.get('perPage') || parsedUrl.searchParams.get('per_page') || 50);
          const q = parsedUrl.searchParams.get('q') || undefined;
          const reports = await loadReports({ limit: perPage, offset: page * perPage, q });
          return send(res, 200, JSON.stringify({ reports, page, perPage }), { 'Content-Type': 'application/json' });
        }

        if (req.method === 'DELETE') {
          const body = await parseBody(req);
          const id = parsedUrl.searchParams.get('id') || (body && body.id);
          if (!id) return send(res, 400, JSON.stringify({ error: 'id required' }), { 'Content-Type': 'application/json' });

          const caller = authCheck(req);
          if (!caller.ok) return send(res, 401, JSON.stringify({ error: 'Unauthorized' }), { 'Content-Type': 'application/json' });
          const session = getSession(req) || {};

          if (caller.role !== 'admin') {
            const items = await getReportsByIds([id]);
            const it = items[0];
            if (!it) return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' });
            if (it.ownerId && it.ownerId !== session.id) return send(res, 403, JSON.stringify({ error: 'Forbidden — cannot delete someone else\'s report' }), { 'Content-Type': 'application/json' });
          }

          await deleteReport(id);
          return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
        }

        if (req.method === 'PATCH') {
          const body = await parseBody(req);
          const id = body?.id || parsedUrl.searchParams.get('id');
          const changes = body?.changes;
          if (!id) return send(res, 400, JSON.stringify({ error: 'id required' }), { 'Content-Type': 'application/json' });
          if (!changes || typeof changes !== 'object') return send(res, 400, JSON.stringify({ error: 'changes required' }), { 'Content-Type': 'application/json' });
          const caller = authCheck(req);
          if (!caller.ok) return send(res, 401, JSON.stringify({ error: 'Unauthorized' }), { 'Content-Type': 'application/json' });
          const session = getSession(req) || {};

          if (caller.role !== 'admin') {
            const items = await getReportsByIds([id]);
            const it = items[0];
            if (!it) return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' });
            if (it.ownerId && it.ownerId !== session.id) return send(res, 403, JSON.stringify({ error: 'Forbidden — cannot update someone else\'s report' }), { 'Content-Type': 'application/json' });
          }

          await updateReport(id, changes);
          return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
        }

        if (req.method === 'POST') {
          const body = await parseBody(req);
          const action = body?.action;
          if (action === 'transfer') {
            const id = body.id;
            const toUserId = body.toUserId;
            const toUserName = body.toUserName || null;
            if (!id || !toUserId) return send(res, 400, JSON.stringify({ error: 'id and toUserId required' }), { 'Content-Type': 'application/json' });

            const caller = authCheck(req);
            if (!caller.ok) return send(res, 401, JSON.stringify({ error: 'Unauthorized' }), { 'Content-Type': 'application/json' });
            const session = getSession(req) || {};

            if (caller.role !== 'admin') {
              const items = await getReportsByIds([id]);
              const it = items[0];
              if (!it) return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' });
              if (it.ownerId && it.ownerId !== session.id) return send(res, 403, JSON.stringify({ error: 'Forbidden — cannot transfer someone else\'s report' }), { 'Content-Type': 'application/json' });
            }

            const prev = (await getReportsByIds([id]))[0] || {};
            const changes = {
              ownerId: toUserId,
              ownerName: toUserName || null,
              previousOwnerId: prev.ownerId || null,
              previousOwnerName: prev.ownerName || null,
              transferredAt: new Date().toISOString(),
              transferredBy: session.id || null,
            };
            await updateReport(id, changes);
            return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
          }
        }

        return send(res, 405, JSON.stringify({ error: 'Method not allowed' }), { 'Content-Type': 'application/json' });
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
  }

  if (parsedUrl.pathname === '/api/process') {
    (async () => {
      try {
        if (!rateLimitCheck(req, res)) return;
        if (!requireAuthDev(req, res)) return;
        return handleApi(req, res);
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
  }

  // Mint a client token so the browser uploads straight to Vercel Blob (bypasses
  // the 4.5MB proxy). Mirrors api/upload-token.js.
  if (parsedUrl.pathname === '/api/upload-token' && req.method === 'POST') {
    (async () => {
      try {
        const body = await parseBody(req);
        const isCompletion = body?.type === 'blob.upload-completed';
        if (!isCompletion) {
          if (!rateLimitCheck(req, res)) return;
          if (!requireAuthDev(req, res)) return;
        }
        const jsonResponse = await handleUpload({
          body,
          request: req,
          onBeforeGenerateToken: async () => ({
            allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
            maximumSizeInBytes: 50 * 1024 * 1024,
            addRandomSuffix: true,
          }),
          onUploadCompleted: async () => {},
        });
        return send(res, 200, JSON.stringify(jsonResponse), { 'Content-Type': 'application/json' });
      } catch (err) {
        return send(res, 400, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
  }
  if (parsedUrl.pathname === '/api/config' && req.method === 'GET') {
    const caller = authCheck(req);
    const session = getSession(req) || null;
    return send(res, 200, JSON.stringify({
      publicApiKey: PUBLIC_API_KEY || null,
      demoMode: DEMO_MODE,
      authMode: usersAuthEnabled() ? 'users' : 'shared',
      blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
      anthropicKey: !!process.env.ANTHROPIC_API_KEY,
      supabase: getSupabaseConfig(),
      sentry: getSentryStatus(),
      session: session ? { id: session.id, role: session.role } : null,
      caller: caller.ok ? (caller.role || (caller.demo ? 'demo' : 'user')) : null,
    }), { 'Content-Type': 'application/json' });
  }

  if (parsedUrl.pathname === '/api/health' && req.method === 'GET') {
    (async () => {
      const deep = parsedUrl.searchParams.get('deep') === '1';
      let supabase = getSupabaseConfig();
      let degraded = false;
      if (deep) {
        const ping = await pingSupabase();
        supabase = { ...supabase, ...ping };
        if (ping.configured && !ping.reachable) degraded = true;
      }
      return send(res, degraded ? 503 : 200, JSON.stringify({
        status: degraded ? 'degraded' : 'ok',
        timestamp: new Date().toISOString(),
        nodeEnv: process.env.NODE_ENV || 'development',
        demoMode: DEMO_MODE,
        blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
        anthropicKey: !!process.env.ANTHROPIC_API_KEY,
        supabase,
        sentry: getSentryStatus(),
      }), { 'Content-Type': 'application/json' });
    })();
    return;
  }

  if (parsedUrl.pathname === '/api/report-pdf' && req.method === 'GET') {
    (async () => {
      try {
        if (!rateLimitCheck(req, res)) return;
        if (!requireAuthDev(req, res)) return;
        const id = parsedUrl.searchParams.get('id');
        if (!id) return send(res, 400, JSON.stringify({ error: 'id required' }), { 'Content-Type': 'application/json' });
        const caller = authCheck(req);
        if (!caller.ok) return send(res, 401, JSON.stringify({ error: 'Unauthorized' }), { 'Content-Type': 'application/json' });
        const session = getSession(req) || {};
        const reports = await getReportsByIds([id]);
        const report = reports[0];
        if (!report) return send(res, 404, JSON.stringify({ error: 'Report not found' }), { 'Content-Type': 'application/json' });
        if (caller.role !== 'admin' && report.ownerId && report.ownerId !== session.id) {
          return send(res, 403, JSON.stringify({ error: 'Forbidden — cannot export someone else\'s report' }), { 'Content-Type': 'application/json' });
        }

        const title = report.reportTitle || report.projectName || report.siteName || report.companyName || 'CanLah Report';
        const filename = `${title.replace(/[^a-zA-Z0-9-_]/g, '_')}-${report.id}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        // Delegate PDF generation to lib/pdf.js
        try {
          const { generateReportPdf } = await import('./lib/pdf.js');
          await generateReportPdf(report, res);
          return;
        } catch (pdfErr) {
          console.error('[pdf] generation failed', pdfErr);
          try { res.end(); } catch (_) {}
          return;
        }
      } catch (err) {
        return send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json' });
      }
    })();
    return;
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

// Optional bootstrap: seed the first admin from env at startup (AUTH_MODE=users).
// Handy for local dev / e2e. Idempotent — skips if the email already exists.
async function maybeSeedAdmin() {
  if (!usersAuthEnabled()) return;
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return;
  try {
    await createUser({ email, password, name: process.env.SEED_ADMIN_NAME || 'Admin', role: 'admin' });
    console.log(`[canlah] seeded admin ${email}`);
  } catch (e) {
    if (!/already registered/.test(e?.message || '')) console.warn('[canlah] admin seed skipped:', e?.message || e);
  }
}

maybeSeedAdmin().finally(() => {
  server.listen(PORT, () => {
    console.log(`Dev server running at http://127.0.0.1:${PORT}`);
  });
});
