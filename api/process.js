// api/process.js
// Two actions:
//   POST multipart/form-data  { action: 'upload', file: <PDF> }
//     → uploads to Anthropic Files API, returns { fileId }
//   POST application/json     { action: 'analyse', fileId: '...' }
//     → runs Claude analysis, returns { data }
//
// bodyParser is disabled so the raw multipart stream is read directly,
// bypassing Vercel's 4.5 MB base64 body limit entirely.

export const config = {
  api: {
    bodyParser: false,
    responseLimit: '10mb',
  },
};

// ── helpers ────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer, boundary) {
  const sep = Buffer.from('--' + boundary);
  const fields = {};
  const files = {};
  let start = 0;

  while (true) {
    const idx = buffer.indexOf(sep, start);
    if (idx === -1) break;
    const end = buffer.indexOf(sep, idx + sep.length);
    if (end === -1) break;
    const part = buffer.slice(idx + sep.length + 2, end - 2);
    start = end;

    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerStr = part.slice(0, headerEnd).toString();
    const body = part.slice(headerEnd + 4);

    const cdMatch = headerStr.match(/Content-Disposition:[^\r\n]*name="([^"]+)"/i);
    const fnMatch = headerStr.match(/filename="([^"]+)"/i);
    const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
    if (!cdMatch) continue;
    const name = cdMatch[1];

    if (fnMatch) {
      files[name] = {
        buffer: body,
        filename: fnMatch[1],
        contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
      };
    } else {
      fields[name] = body.toString().trim();
    }
  }
  return { fields, files };
}

// ── main handler ───────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ct = req.headers['content-type'] || '';

  // ── UPLOAD ─────────────────────────────────────────────────────────────
  if (ct.includes('multipart/form-data')) {
    const bm = ct.match(/boundary=([^\s;]+)/);
    if (!bm) return res.status(400).json({ error: 'No multipart boundary' });

    const raw = await readBody(req);
    const { files } = parseMultipart(raw, bm[1]);
    const pdf = files.file;
    if (!pdf) return res.status(400).json({ error: 'No file field found' });

    const form = new FormData();
    form.append('file', new Blob([pdf.buffer], { type: pdf.contentType }), pdf.filename || 'upload.pdf');

    const up = await fetch('https://api.anthropic.com/v1/files', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'files-api-2025-04-14',
      },
      body: form,
    });

    if (!up.ok) return res.status(500).json({ error: await up.text() });
    const upData = await up.json();
    return res.status(200).json({ fileId: upData.id });
  }

  // ── ANALYSE ────────────────────────────────────────────────────────────
  if (ct.includes('application/json')) {
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw.toString()); }
    catch { return res.status(400).json({ error: 'Invalid JSON' }); }

    const { action, fileId } = body;
    if (action !== 'analyse') return res.status(400).json({ error: `Unknown action: ${action}` });
    if (!fileId) return res.status(400).json({ error: 'fileId required' });

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
            { type: 'text', text: `You are analysing a Singapore traffic data report (PDF).
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

Use null for missing fields. Extract as many locations as possible.` }
          ]
        }]
      }),
    });

    if (!msgRes.ok) return res.status(500).json({ error: await msgRes.text() });
    const msgData = await msgRes.json();
    const text = msgData.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    return res.status(200).json({ data: parsed });
  }

  return res.status(400).json({ error: 'Unsupported content-type' });
}
