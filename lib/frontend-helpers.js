// Pure frontend helpers, extracted from canlah.js so the logic is unit-testable
// in node and shared (single source) with the browser via dynamic import
// (`import('/lib/frontend-helpers.js')`). No DOM, no fetch — pure functions only.

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Map a filename's extension to an upload MIME type. */
export function extToMime(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

/** Number of chunks needed to upload `size` bytes at `chunkSize` bytes each. */
export function chunkCount(size, chunkSize) {
  if (!(chunkSize > 0)) return 0;
  return Math.ceil(Math.max(0, size) / chunkSize);
}

/** Byte range [start, end) for chunk `index` (0-based). `end` is clamped to size. */
export function chunkRange(index, size, chunkSize) {
  const start = index * chunkSize;
  const end = Math.min(size, start + chunkSize);
  return { start, end };
}

/** Safe download filename for a report's JSON export. */
export function reportFilename(report = {}) {
  const base =
    report.reportTitle || report.projectName || report.siteName || report.companyName || 'canlah-report';
  const safe = String(base).replace(/[^a-zA-Z0-9-_]/g, '_');
  return `${safe}-${report.id || 'report'}.json`;
}

/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
