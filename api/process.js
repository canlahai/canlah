// api/process.js
// Actions:
//   POST { action: 'upload-start', filename }
//     → creates a multipart upload in Vercel Blob, returns { key, uploadId }
//   POST { action: 'upload-part', key, uploadId, partNumber, data (base64) }
//     → uploads one chunk, returns { etag, partNumber }
//   POST { action: 'upload-complete', key, uploadId, parts }
//     → completes the multipart upload, gets blob URL, uploads to Anthropic, returns { fileId }
//   POST { action: 'upload', fileData, fileName, mimeType }
//     → uploads a file from base64 to Vercel Blob, returns { blobUrl }
//   POST { action: 'analyse', fileId }
//     → runs Claude analysis for tree extraction, returns { data }
//   POST { action: 'analyse', blobUrl, prompt }
//     → runs Claude analysis for any prompt using a public blob URL, returns full Anthropic response

import { createMultipartUpload, completeMultipartUpload } from '@vercel/blob';
import { requireAuth, authCheck } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { isAllowedBlobUrl } from '../lib/blob-url.js';
import { usersAuthEnabled, consumeRead } from '../lib/users.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

const TREE_EXTRACTION_PROMPT = `You are an expert Singapore construction document analyst specialising in NParks / LTA tree felling drawings. Analyse this tree affected plan and extract ALL tree data.

Extract every tree record from every table on every sheet. Return ONLY valid JSON in this exact structure:

\`\`\`json
{
  "projectName": "project name from drawing title block",
  "drawingRef": "drawing reference number e.g. L/RC216/RR/WSCL/0014",
  "authority": "LTA or NParks or BCA",
  "sheets": [
    {
      "sheetNo": "e.g. LRC216/RR/WSCL/0001",
      "removeCount": 105,
      "retainCount": 181
    }
  ],
  "trees": [
    {
      "no": "E4807",
      "girth": 0.4,
      "height": 4.0,
      "species": "Indian Mango",
      "sheet": "0001",
      "flags": []
    }
  ],
  "dataIssues": [
    "Duplicate tree numbers: E4948, E4949 appear twice",
    "Missing girth/height: E4583, E4585",
    "Blank species: E7887"
  ],
  "totalRemove": 500,
  "totalRetain": 200
}
\`\`\`

CRITICAL RULES:
- Extract EVERY tree from EVERY table — do not truncate
- For girth/height = "-" or blank → use null
- For "Cluster" girth → use -1 (special flag)
- Detect duplicates (same tree number appearing more than once)
- Detect missing data (null girth or null height or blank species)
- Flag trees with girth > 3.0m as potential Heritage Trees in their flags array: ["heritage_candidate"]
- Flag trees with girth > 1.0m in flags array: ["protected"]
- Flag high conservation species (Rain Tree, Angsana, Tembusu, Senegal Mahogany) in flags: ["high_conservation"]
- Flag invasive species (African Tulip Tree, Taiwan Acacia) in flags: ["invasive"]
- Flag duplicates with: ["duplicate"]
- Flag missing data with: ["missing_data"]

Return ONLY the JSON object. No preamble, no explanation.`;

const TRAFFIC_EXTRACTION_PROMPT = `You are an expert traffic-survey analyst. Analyse this Singapore traffic count / traffic impact report and extract the vehicle count data.

Return ONLY valid JSON in this exact structure:

\`\`\`json
{
  "reportTitle": "title from the report",
  "reportDate": "survey date, e.g. 2025-03-14 (or the date range as written)",
  "summary": { "totalLocations": 3, "totalVehicles": 48213 },
  "locations": [
    {
      "locationId": "e.g. C1",
      "locationName": "junction / count station name",
      "roadName": "road or street name",
      "direction": "e.g. Northbound / NB",
      "lanes": 2,
      "dailyTotal": 16500,
      "peakHour": "08:00",
      "peakVolume": 1820,
      "hourlyData": [ { "hour": "00:00", "volume": 120 } ]
    }
  ]
}
\`\`\`

RULES:
- Extract EVERY count station / location and ALL hourly rows you can find.
- "hour" as HH:MM (24h). "volume" = total vehicles that hour (integer).
- Compute dailyTotal, peakHour, peakVolume per location if not stated.
- summary.totalVehicles = sum of all daily totals; summary.totalLocations = count of locations.
- Use null for any field genuinely absent. Do not invent numbers.

Return ONLY the JSON object. No preamble, no explanation.`;

// Server-held extraction prompts keyed by document type (the client sends a
// reportType, never a raw prompt — keeps big prompts server-side + limits abuse).
export const PROMPTS = {
  tree: TREE_EXTRACTION_PROMPT,
  'tree-felling': TREE_EXTRACTION_PROMPT,
  traffic: TRAFFIC_EXTRACTION_PROMPT,
};

const createSafeBlobKey = filename => {
  const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `uploads/${Date.now()}-${safeName}`;
};


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

async function uploadBufferToBlob(filename, buffer, contentType) {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    throw new Error('Missing BLOB_READ_WRITE_TOKEN environment variable');
  }

  const key = createSafeBlobKey(filename);
  const { key: blobKey, uploadId } = await createMultipartUpload(key, {
    access: 'public',
    contentType,
    token: blobToken,
  });
  const part = await uploadPartDirect(blobKey, uploadId, 1, buffer, blobToken);

  return completeMultipartUpload(blobKey, [part], {
    access: 'public',
    uploadId,
    contentType,
    token: blobToken,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res).ok) return;
  // Each analyse/upload call can spend real Anthropic/Blob money — throttle per IP.
  if (!(await enforceRateLimit(req, res, { id: 'process', limit: 30, windowMs: 60_000 }))) return;

  const action = (req.headers['x-action'] || req.body?.action || '').toString();
  const body = req.body || {};

  if (action === 'upload-start') {
    const { filename, mimeType } = body;
    if (!filename) return res.status(400).json({ error: 'filename required' });
    const contentType = mimeType || 'application/pdf';
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    if (!blobToken) return res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN environment variable' });

    try {
      const { key, uploadId } = await createMultipartUpload(createSafeBlobKey(filename), {
        access: 'public',
        contentType,
        token: blobToken,
      });
      console.log('[api] upload-start created', { key, uploadId: String(uploadId).slice(0, 60) + '...' });
      return res.status(200).json({ key, uploadId });
    } catch (err) {
      captureException(err);
      log.error('[api/process] upload-start failed', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'upload-part') {
    const { key, uploadId, partNumber, data, mimeType } = body;
    if (!key || !uploadId || !partNumber || !data) {
      return res.status(400).json({ error: 'key, uploadId, partNumber, and data are required' });
    }
    const contentType = mimeType || 'application/pdf';

    try {
      const buffer = Buffer.from(data, 'base64');
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
      if (!blobToken) return res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN environment variable' });
      const part = await uploadPartDirect(key, uploadId, partNumber, buffer, blobToken);
      console.log('[api] upload-part result', { key, uploadId: String(uploadId).slice(0,60) + '...', partNumber, byteLength: buffer.length, etag: part?.etag });
      return res.status(200).json(part);
    } catch (err) {
      captureException(err);
      log.error('[api/process] upload-part failed', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'upload-complete') {
    const { key, uploadId, parts, mimeType } = body;
    if (!key || !uploadId || !Array.isArray(parts)) {
      return res.status(400).json({ error: 'key, uploadId, and parts are required' });
    }
    const contentType = mimeType || 'application/pdf';

    try {
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
      if (!blobToken) return res.status(500).json({ error: 'Missing BLOB_READ_WRITE_TOKEN environment variable' });
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
      form.append('file', new Blob([pdfBytes], { type: contentType }), 'upload.pdf');

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

      try {
        const { del } = await import('@vercel/blob');
        await del(blob.url);
      } catch (_) {}

      return res.status(200).json({ fileId: upData.id });
    } catch (err) {
      captureException(err);
      log.error('[api/process] upload-complete failed', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'upload') {
    const { fileData, fileName, mimeType } = body;
    if (!fileData || !fileName || !mimeType) {
      return res.status(400).json({ error: 'fileData, fileName, and mimeType are required' });
    }

    try {
      const buffer = Buffer.from(fileData, 'base64');
      const blob = await uploadBufferToBlob(fileName, buffer, mimeType);
      return res.status(200).json({ blobUrl: blob.url });
    } catch (err) {
      captureException(err);
      log.error('[api/process] upload failed', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // Hand an already-uploaded Blob (from the browser direct upload) to Anthropic's
  // Files API and return a file_id. This is the large-file path: the browser
  // uploaded straight to Blob via /api/upload-token, bypassing the 4.5MB proxy.
  if (action === 'ingest') {
    const { blobUrl } = body;
    if (!blobUrl) return res.status(400).json({ error: 'blobUrl required' });
    if (!isAllowedBlobUrl(blobUrl)) return res.status(400).json({ error: 'blobUrl must be a Vercel Blob URL' });
    try {
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
      return res.status(200).json({ fileId: upData.id });
    } catch (err) {
      captureException(err);
      log.error('[api/process] ingest failed', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'analyse') {
    const { fileId, blobUrl, prompt, reportType } = body;
    if (!fileId && !blobUrl) {
      return res.status(400).json({ error: 'fileId or blobUrl is required' });
    }
    // Don't let the endpoint become an open LLM proxy: only analyse documents
    // hosted on our own Vercel Blob, never an arbitrary attacker-supplied URL.
    if (!fileId && !isAllowedBlobUrl(blobUrl)) {
      return res.status(400).json({ error: 'blobUrl must be a Vercel Blob URL' });
    }

    // Free-tier monthly read quota (per-user auth only; admin/pro are unlimited).
    if (usersAuthEnabled()) {
      const caller = authCheck(req);
      if (caller.ok && caller.id) {
        const limit = Number(process.env.READS_FREE_LIMIT) || 10;
        let quota;
        try {
          quota = await consumeRead(caller.id, { limit });
        } catch (e) {
          captureException(e);
          log.error('[api/process] consumeRead failed', e?.message || e);
          quota = { ok: true }; // fail open — don't block paid work on a counter glitch
        }
        if (!quota.ok && quota.reason === 'limit') {
          return res.status(402).json({
            error: `Free plan limit reached (${quota.limit} reads this month). Upgrade to Pro for unlimited reads.`,
            code: 'read_limit',
            limit: quota.limit,
          });
        }
      }
    }

    try {
      const content = [];
      if (fileId) {
        content.push({ type: 'document', source: { type: 'file', file_id: fileId } });
      } else {
        content.push({ type: 'document', source: { type: 'url', url: blobUrl } });
      }
      // Prompt resolution: explicit client prompt (pillars) → server prompt by
      // reportType (readers) → tree default for a bare fileId.
      const finalPrompt = prompt || PROMPTS[reportType] || (fileId ? TREE_EXTRACTION_PROMPT : '');
      if (!finalPrompt) {
        return res.status(400).json({ error: 'No prompt provided for analysis' });
      }
      content.push({ type: 'text', text: finalPrompt });

      const msgRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'files-api-2025-04-14',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          messages: [{ role: 'user', content }],
        }),
      });

      if (!msgRes.ok) {
        const errorText = await msgRes.text();
        return res.status(500).json({ error: errorText });
      }

      const msgData = await msgRes.json();
      if (fileId) {
        const text = msgData.content.filter(b => b.type === 'text').map(b => b.text).join('');
        const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
        return res.status(200).json({ data: parsed });
      }

      return res.status(200).json(msgData);
    } catch (err) {
      captureException(err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
