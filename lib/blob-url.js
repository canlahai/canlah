// Allowlist for URLs we'll hand to Anthropic as a document source.
//
// The `analyse` action can take a `blobUrl`. Without a check, any authenticated
// caller could point it at an arbitrary URL and use our Anthropic key as an open
// LLM proxy (and have Anthropic fetch arbitrary hosts). We only ever produce
// Vercel Blob URLs ourselves, so restrict to that host family.

// Vercel Blob public URLs look like:
//   https://<store>.public.blob.vercel-storage.com/<path>
// and the API base is blob.vercel-storage.com. Allow both, plus an optional
// override host derived from VERCEL_BLOB_API_URL for self-hosted/test setups.
function extraAllowedHost() {
  const base = process.env.VERCEL_BLOB_API_URL || process.env.NEXT_PUBLIC_VERCEL_BLOB_API_URL;
  if (!base) return null;
  try { return new URL(base).hostname.toLowerCase(); } catch { return null; }
}

export function isAllowedBlobUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false; // no http/file/data/etc.
  const host = u.hostname.toLowerCase();
  if (host === 'blob.vercel-storage.com' || host.endsWith('.blob.vercel-storage.com')) return true;
  const extra = extraAllowedHost();
  return extra ? host === extra : false;
}
