// api/process.js
// Accepts either:
//   { action: 'upload', blobUrl: '...' }   <- new blob URL path (no size limit)
//   { action: 'analyse', fileId: '...' }   <- analyse a previously uploaded file
//
// The old base64 path is removed — all uploads now come via Vercel Blob.

import Anthropic from '@anthropic-ai/sdk';

export const config = { runtime: 'edge' };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { action } = body;

  // ── UPLOAD action ──────────────────────────────────────────────────────────
  // Fetch the PDF from Blob storage and upload it to Anthropic Files API.
  if (action === 'upload') {
    const { blobUrl } = body;
    if (!blobUrl) {
      return new Response(JSON.stringify({ error: 'blobUrl is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // Fetch the PDF from Vercel Blob (server-to-server, no size limit issues)
      const pdfResponse = await fetch(blobUrl);
      if (!pdfResponse.ok) {
        throw new Error(`Failed to fetch blob: ${pdfResponse.status}`);
      }

      const pdfBuffer = await pdfResponse.arrayBuffer();
      const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });

      // Upload to Anthropic Files API
      const formData = new FormData();
      formData.append('file', pdfBlob, 'traffic-report.pdf');

      const uploadResponse = await fetch('https://api.anthropic.com/v1/files', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'files-api-2025-04-14',
        },
        body: formData,
      });

      if (!uploadResponse.ok) {
        const err = await uploadResponse.text();
        throw new Error(`Anthropic upload failed: ${err}`);
      }

      const uploadData = await uploadResponse.json();

      return new Response(JSON.stringify({ fileId: uploadData.id }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── ANALYSE action ─────────────────────────────────────────────────────────
  // Use a previously uploaded Anthropic file ID to extract traffic data.
  if (action === 'analyse') {
    const { fileId } = body;
    if (!fileId) {
      return new Response(JSON.stringify({ error: 'fileId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const message = await anthropic.beta.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
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
                text: `You are analysing a Singapore traffic data report (PDF).
Extract ALL traffic count data you can find and return it as a single JSON object.

Return ONLY valid JSON, no markdown, no explanation. Structure:

{
  "reportTitle": "string",
  "reportDate": "string",
  "locations": [
    {
      "locationId": "string",
      "locationName": "string",
      "roadName": "string",
      "direction": "string",
      "lanes": number,
      "hourlyData": [
        {
          "hour": "HH:MM",
          "volume": number,
          "speed": number | null,
          "occupancy": number | null
        }
      ],
      "dailyTotal": number,
      "peakHour": "HH:MM",
      "peakVolume": number
    }
  ],
  "summary": {
    "totalLocations": number,
    "totalVehicles": number,
    "dataDate": "string",
    "notes": "string"
  }
}

If any field is not available in the document, use null. Extract as many locations as possible.`,
              },
            ],
          },
        ],
        betas: ['files-api-2025-04-14'],
      });

      const responseText = message.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');

      // Strip any accidental markdown fences
      const clean = responseText.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      return new Response(JSON.stringify({ data: parsed }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message, raw: error.toString() }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}
