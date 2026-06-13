// Mints a client token so the browser can upload DIRECTLY to Vercel Blob,
// bypassing Vercel's 4.5MB request-body proxy limit entirely. The client uses
// `upload(file, { handleUploadUrl: '/api/upload-token' })` from @vercel/blob/client;
// this route answers the token request (and the upload-completed webhook).
//
// After the direct upload, the client calls /api/process { action: 'ingest',
// blobUrl } to hand the blob to Anthropic.

import { handleUpload } from '@vercel/blob/client';
import { requireAuth } from '../lib/auth.js';
import { enforceRateLimit } from '../lib/rate-limit.js';
import { initSentry, captureException } from '../lib/sentry.js';
import * as log from '../lib/log.js';

initSentry();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // The token request comes from an authenticated user; the upload-completed
  // event is a server→server webhook (no cookie) that handleUpload verifies by
  // signature — don't gate that one behind user auth.
  const isCompletion = req.body?.type === 'blob.upload-completed';
  if (!isCompletion) {
    if (!requireAuth(req, res).ok) return;
    if (!(await enforceRateLimit(req, res, { id: 'upload-token', limit: 30, windowMs: 60_000 }))) return;
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['application/pdf', 'image/jpeg', 'image/png'],
        maximumSizeInBytes: 50 * 1024 * 1024, // 50MB ceiling
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {
        // No-op: the client gets the blob URL from upload()'s return value and
        // drives ingestion itself. (This webhook only fires on Vercel.)
      },
    });
    return res.status(200).json(jsonResponse);
  } catch (error) {
    captureException(error);
    log.error('[api/upload-token] failed', error?.message || error);
    return res.status(400).json({ error: error.message || 'upload token request failed' });
  }
}
