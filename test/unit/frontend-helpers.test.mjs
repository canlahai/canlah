import assert from 'node:assert/strict';
import { extToMime, chunkCount, chunkRange, reportFilename, formatBytes } from '../../lib/frontend-helpers.js';

// --- extToMime --------------------------------------------------------------
assert.equal(extToMime('drawing.pdf'), 'application/pdf', 'pdf');
assert.equal(extToMime('photo.JPG'), 'image/jpeg', 'uppercase ext');
assert.equal(extToMime('a.b.jpeg'), 'image/jpeg', 'multi-dot uses last ext');
assert.equal(extToMime('x.png'), 'image/png', 'png');
assert.equal(extToMime('notes.txt'), 'application/octet-stream', 'unknown ext -> octet-stream');
assert.equal(extToMime(''), 'application/octet-stream', 'empty');
assert.equal(extToMime(null), 'application/octet-stream', 'null');

// --- chunkCount -------------------------------------------------------------
const CHUNK = 3 * 1024 * 1024;
assert.equal(chunkCount(0, CHUNK), 0, 'zero bytes -> 0 chunks');
assert.equal(chunkCount(1, CHUNK), 1, '1 byte -> 1 chunk');
assert.equal(chunkCount(CHUNK, CHUNK), 1, 'exactly one chunk');
assert.equal(chunkCount(CHUNK + 1, CHUNK), 2, 'one over -> 2 chunks');
assert.equal(chunkCount(10 * 1024 * 1024, CHUNK), 4, '10MB / 3MB -> 4');
assert.equal(chunkCount(100, 0), 0, 'zero chunkSize -> 0 (no divide-by-zero)');

// --- chunkRange -------------------------------------------------------------
assert.deepEqual(chunkRange(0, 10, 3), { start: 0, end: 3 }, 'first chunk');
assert.deepEqual(chunkRange(1, 10, 3), { start: 3, end: 6 }, 'middle chunk');
assert.deepEqual(chunkRange(3, 10, 3), { start: 9, end: 10 }, 'last chunk clamps to size');
// ranges tile the whole file with no gaps/overlaps
const size = 10 * 1024 * 1024 + 7;
let covered = 0;
for (let i = 0; i < chunkCount(size, CHUNK); i++) {
  const { start, end } = chunkRange(i, size, CHUNK);
  assert.equal(start, covered, `chunk ${i} starts where previous ended`);
  covered = end;
}
assert.equal(covered, size, 'chunks cover exactly the whole file');

// --- reportFilename ---------------------------------------------------------
assert.equal(reportFilename({ reportTitle: 'Road Viaduct', id: 'r-1' }), 'Road_Viaduct-r-1.json', 'spaces -> underscores');
assert.equal(reportFilename({ projectName: 'A/B:C*', id: 'x' }), 'A_B_C_-x.json', 'unsafe chars sanitized');
assert.equal(reportFilename({ id: 'z' }), 'canlah-report-z.json', 'falls back to default base');
assert.equal(reportFilename({}), 'canlah-report-report.json', 'empty report -> safe defaults');
assert.equal(reportFilename({ companyName: 'Acme', }), 'Acme-report.json', 'companyName fallback chain');

// --- formatBytes ------------------------------------------------------------
assert.equal(formatBytes(0), '0 B', 'zero');
assert.equal(formatBytes(512), '512 B', 'bytes');
assert.equal(formatBytes(1536), '1.5 KB', 'kilobytes');
assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB', 'megabytes');
assert.equal(formatBytes('not a number'), '0 B', 'non-numeric -> 0 B');

console.log('frontend-helpers.test.mjs — all assertions passed');
