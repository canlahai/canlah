// api/process.js
// Edge runtime — no 4.5MB body limit (Vercel's limit only applies to
// the Node.js serverless runtime with bodyParser).
//
// Actions:
//   POST with Content-Type: application/pdf   → upload to Anthropic, return { fileId }
//   POST with Content-Type: application/json  → { action:'analyse', fileId } → { data }

export const config = { runtime: 'edge' };

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const ct = request.headers.get('content-type') || '';

  // ── UPLOAD: browser sends raw PDF bytes ──────────────────────────────────
  if (ct.includes('application/pdf')) {
    try {
      const pdfBytes = await request.arrayBuffer();

      const form = new FormData();
      form.append(
        'file',
        new Blob([pdfBytes], { type: 'application/pdf' }),
        'upload.pdf'
      );

      const upRes = await fetch('https://api.anthropic.com/v1/files', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'files-api-2025-04-14',
        },
        body: form,
      });

      if (!upRes.ok) {
        const err = await upRes.text();
        return new Response(JSON.stringify({ error: `Anthropic upload failed: ${err}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const upData = await upRes.json();
      return new Response(JSON.stringify({ fileId: upData.id }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── ANALYSE: { action: 'analyse', fileId } ───────────────────────────────
  if (ct.includes('application/json')) {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
    }

    const { action, fileId } = body;
    if (action !== 'analyse') {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }
    if (!fileId) {
      return new Response(JSON.stringify({ error: 'fileId required' }), { status: 400 });
    }

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

      if (!msgRes.ok) {
        const err = await msgRes.text();
        return new Response(JSON.stringify({ error: `Claude API error: ${err}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const msgData = await msgRes.json();
      const text = msgData.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      return new Response(JSON.stringify({ data: parsed }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Unsupported content-type' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}
