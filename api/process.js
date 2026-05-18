import { put, del } from '@vercel/blob';

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Action');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const action = req.headers['x-action'] || 'analyse';

  // ── UPLOAD: save file to Vercel Blob, return blob URL ──
  if (action === 'upload') {
    try {
      const { fileData, fileName, mimeType } = req.body;
      if (!fileData) return res.status(400).json({ error: 'No file data' });

      const binary = Buffer.from(fileData, 'base64');
      const blob = await put(fileName || 'upload.pdf', binary, {
        access: 'public',
        contentType: mimeType || 'application/pdf',
      });

      return res.status(200).json({ blobUrl: blob.url });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ANALYSE: fetch from Blob, upload to Anthropic, analyse, delete ──
  if (action === 'analyse') {
    try {
      const { blobUrl, prompt } = req.body;
      if (!blobUrl) return res.status(400).json({ error: 'No blobUrl' });

      // Fetch file from Vercel Blob
      const blobResp = await fetch(blobUrl);
      if (!blobResp.ok) throw new Error('Failed to fetch blob');
      const fileBuffer = Buffer.from(await blobResp.arrayBuffer());
      const mimeType = blobResp.headers.get('content-type') || 'application/pdf';
      const fileName = blobUrl.split('/').pop() || 'document.pdf';

      // Upload to Anthropic Files API
      const boundary = 'X' + Math.random().toString(36).slice(2);
      const header = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([header, fileBuffer, footer]);

      const uploadResp = await fetch('https://api.anthropic.com/v1/files', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'files-api-2025-04-14',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });
      const uploadData = await uploadResp.json();
      if (!uploadData.id) throw new Error('Upload to Anthropic failed: ' + JSON.stringify(uploadData));
      const fileId = uploadData.id;

      // Analyse with Claude
      const analyseResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'files-api-2025-04-14',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 8000,
          messages: [{
            role: 'user',
            content: [
              { type: 'document', source: { type: 'file', file_id: fileId } },
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });
      const result = await analyseResp.json();

      // Delete blob after analysis (cleanup)
      try { await del(blobUrl); } catch(e) { /* non-fatal */ }

      return res.status(analyseResp.status).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
