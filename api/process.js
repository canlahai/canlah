import { handleUpload } from '@vercel/blob/client';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Action');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const action = req.headers['x-action'] || 'analyse';

  // ── BLOB CLIENT UPLOAD HANDLER ──
  if (action === 'blob-upload') {
    try {
      const body = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      });
      const jsonResponse = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname) => ({
          allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
          maximumSizeInBytes: 50 * 1024 * 1024,
        }),
        onUploadCompleted: async ({ blob }) => {
          console.log('Upload completed:', blob.url);
        },
      });
      return res.status(200).json(jsonResponse);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // ── ANALYSE ──
  if (action === 'analyse') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const { blobUrl, prompt } = JSON.parse(Buffer.concat(chunks).toString());
      if (!blobUrl) return res.status(400).json({ error: 'No blobUrl' });

      const blobResp = await fetch(blobUrl);
      if (!blobResp.ok) throw new Error('Failed to fetch blob: ' + blobResp.status);
      const fileBuffer = Buffer.from(await blobResp.arrayBuffer());
      const mimeType = blobResp.headers.get('content-type') || 'application/pdf';
      const fileName = blobUrl.split('/').pop().split('?')[0] || 'document.pdf';

      const boundary = 'X' + Math.random().toString(36).slice(2);
      const header = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + fileName + '"\r\nContent-Type: ' + mimeType + '\r\n\r\n');
      const footer = Buffer.from('\r\n--' + boundary + '--\r\n');
      const body = Buffer.concat([header, fileBuffer, footer]);

      const uploadResp = await fetch('https://api.anthropic.com/v1/files', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'files-api-2025-04-14',
          'Content-Type': 'multipart/form-data; boundary=' + boundary,
        },
        body,
      });
      const uploadData = await uploadResp.json();
      if (!uploadData.id) throw new Error('Anthropic upload failed: ' + JSON.stringify(uploadData));

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
              { type: 'document', source: { type: 'file', file_id: uploadData.id } },
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });
      const result = await analyseResp.json();

      try {
        const { del } = await import('@vercel/blob');
        await del(blobUrl);
      } catch(e) {}

      return res.status(analyseResp.status).json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
