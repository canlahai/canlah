export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Action');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const action = req.headers['x-action'] || 'analyse';

  // ── ACTION 1: Upload file to Anthropic Files API ──
  if (action === 'upload') {
    try {
      const { fileData, fileName, mimeType } = req.body;
      if (!fileData) return res.status(400).json({ error: 'No file data provided' });

      // Convert base64 to binary
      const binaryData = Buffer.from(fileData, 'base64');

      // Build multipart form data
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const formHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName || 'document.pdf'}"\r\nContent-Type: ${mimeType || 'application/pdf'}\r\n\r\n`;
      const formFooter = `\r\n--${boundary}--\r\n`;

      const headerBuf = Buffer.from(formHeader, 'utf8');
      const footerBuf = Buffer.from(formFooter, 'utf8');
      const body = Buffer.concat([headerBuf, binaryData, footerBuf]);

      const uploadResp = await fetch('https://api.anthropic.com/v1/files', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'files-api-2025-04-14',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length.toString(),
        },
        body: body,
      });

      const uploadData = await uploadResp.json();
      return res.status(uploadResp.status).json(uploadData);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ACTION 2: Analyse using file_id ──
  if (action === 'analyse') {
    try {
      const { fileId, prompt } = req.body;
      if (!fileId) return res.status(400).json({ error: 'No file_id provided' });

      const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
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
              {
                type: 'document',
                source: {
                  type: 'file',
                  file_id: fileId,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          }],
        }),
      });

      const data = await anthropicResp.json();
      return res.status(anthropicResp.status).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── LEGACY: Direct messages passthrough (fallback) ──
  try {
    const body = req.body;
    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: body.messages,
      }),
    });
    const data = await anthropicResp.json();
    return res.status(anthropicResp.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
