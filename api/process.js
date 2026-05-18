// api/process.js
// Actions:
//   POST { action: 'upload-start', filename }
//     → creates a multipart upload in Vercel Blob, returns { key, uploadId }
//   POST { action: 'upload-part', key, uploadId, partNumber, data (base64) }
//     → uploads one chunk, returns { etag, partNumber }
//   POST { action: 'upload-complete', key, uploadId, parts, blobPathname }
//     → completes the multipart upload, gets blob URL, uploads to Anthropic, returns { fileId }
//   POST { action: 'analyse', fileId }
//     → runs Claude analysis, returns { data }

import { createMultipartUpload, uploadPart, completeMultipartUpload } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  // ── START MULTIPART ────────────────────────────────────────────────────────
  if (action === 'upload-start') {
    const { filename } = req.body;
    try {
      const { key, uploadId } = await createMultipartUpload(
        `traffic-uploads/${filename}`,
        { access: 'public', contentType: 'application/pdf' }
      );
      return res.status(200).json({ key, uploadId });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── UPLOAD PART ────────────────────────────────────────────────────────────
  if (action === 'upload-part') {
    const { key, uploadId, partNumber, data } = req.body;
    try {
      // data is base64-encoded chunk from browser
      const buffer = Buffer.from(data, 'base64');
      const part = await uploadPart(key, buffer, {
        access: 'public',
        uploadId,
        partNumber,
        contentType: 'application/pdf',
      });
      return res.status(200).json(part);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── COMPLETE MULTIPART → upload to Anthropic ───────────────────────────────
  if (action === 'upload-complete') {
    const { key, uploadId, parts } = req.body;
    try {
      // Complete the Vercel Blob multipart upload → get a public URL
      const blob = await completeMultipartUpload(key, parts, {
        access: 'public',
        uploadId,
        contentType: 'application/pdf',
      });

      // Fetch the PDF from Blob and upload to Anthropic Files API
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

      // Clean up blob (optional, don't fail if this errors)
      try {
        const { del } = await import('@vercel/blob');
        await del(blob.url);
      } catch (_) {}

      return res.status(200).json({ fileId: upData.id });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ANALYSE ────────────────────────────────────────────────────────────────
  if (action === 'analyse') {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ error: 'fileId required' });

    try {
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
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'file', file_id: fileId } },
              {
                type: 'text',
                text: `You are analysing a Singapore traffic data report (PDF).
Extract ALL traffic count data and return ONLY valid JSON, no markdown, no explanation:

{
  "reportTitle": "string",
  "reportDate": "string",
  "locations": [{
    "locationId": "string",
    "locationName": "string",
    "roadName": "string",
    "direction": "string",
    "lanes": number,
    "hourlyData": [{ "hour": "HH:MM", "volume": number, "speed": number|null, "occupancy": number|null }],
    "dailyTotal": number,
    "peakHour": "HH:MM",
    "peakVolume": number
  }],
  "summary": { "totalLocations": number, "totalVehicles": number, "dataDate": "string", "notes": "string" }
}

Use null for missing fields. Extract as many locations as possible.`
              }
            ]
          }]
        }),
      });

      if (!msgRes.ok) return res.status(500).json({ error: await msgRes.text() });
      const msgData = await msgRes.json();
      const text = msgData.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      return res.status(200).json({ data: parsed });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
}
