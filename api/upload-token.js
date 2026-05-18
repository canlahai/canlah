// api/upload-token.js
// Issues a Vercel Blob client upload token so the browser can upload
// directly to Blob storage, bypassing Vercel's 4.5MB proxy body limit.

import { handleUpload } from '@vercel/blob/client';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const body = await request.json();

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Allow PDF uploads only, max 20MB
        return {
          allowedContentTypes: ['application/pdf'],
          maximumSizeInBytes: 20 * 1024 * 1024, // 20MB
          tokenPayload: JSON.stringify({ pathname }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        // Optional: log or record the upload
        console.log('Upload completed:', blob.url);
      },
    });

    return new Response(JSON.stringify(jsonResponse), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
