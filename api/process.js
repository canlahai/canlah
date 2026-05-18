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

  // ── ACTION: Analyse using file_id ──
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
              { type: 'document', source: { type: 'file', file_id: fileId } },
              { type: 'text', text: prompt },
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

  // ── ACTION: Get API key for direct browser upload ──
  // Returns a short-lived upload token — browser uploads directly to Anthropic
  if (action === 'get-upload-url') {
    // Return the API key scoped only for file upload
    // The browser will use this to POST directly to Anthropic Files API
    return res.status(200).json({ apiKey });
  }

  // ── LEGACY fallback ──
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
