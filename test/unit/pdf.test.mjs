import { PassThrough } from 'node:stream';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
await rm(path.join(DATA_DIR, 'reports.json'), { force: true });

import { saveReport } from '../../lib/reports.js';
import { generateReportPdf } from '../../lib/pdf.js';

const sample = {
  id: 'pdf-unit-1',
  savedAt: new Date().toISOString(),
  reportTitle: 'PDF Unit Test',
  reportType: 'bq',
  report: { sample: true, trees: [ { no: 'E0001', species: 'Test', girth: 0.3, height: 4.0 } ] }
};

await saveReport(sample);

const out = new PassThrough();
const chunks = [];
out.on('data', (c) => chunks.push(c));
await generateReportPdf(sample, out);
const buf = Buffer.concat(chunks);
assert.ok(buf.length > 100, 'PDF payload should be non-empty and >100 bytes');
assert.equal(buf.slice(0, 5).toString('utf8'), '%PDF-', 'PDF output must start with %PDF-');

console.log('PDF unit test passed');
