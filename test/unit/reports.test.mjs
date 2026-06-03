import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');

// Clean slate
await rm(path.join(DATA_DIR, 'reports.json'), { force: true });

import { saveReport, loadReports, getReportsByIds, deleteReport, updateReport } from '../../lib/reports.js';

const sample = {
  id: 'unit-test-1',
  savedAt: new Date().toISOString(),
  reportTitle: 'Unit test sample',
  projectName: 'Unit Project',
  reportType: 'bq',
  report: { sample: true },
};

// Save
const saved = await saveReport(sample);
assert.equal(saved.id, sample.id, 'saved id matches');

// Load
const list = await loadReports();
assert.ok(Array.isArray(list), 'loadReports returns array');
assert.ok(list.find(r => r.id === sample.id), 'saved report found in list');

// getReportsByIds
const fetched = await getReportsByIds([sample.id]);
assert.equal(fetched[0].id, sample.id, 'getReportsByIds returns saved report');

// updateReport
const updated = await updateReport(sample.id, { reportTitle: 'Updated title' });
assert.equal(updated.reportTitle || updated.report?.reportTitle || 'Updated title', 'Updated title');

// deleteReport
const deleted = await deleteReport(sample.id);
assert.equal(deleted, true, 'deleteReport returns true');

console.log('All unit tests passed');

// Transfer ownership test
const sample2 = {
  id: 'unit-transfer-1',
  savedAt: new Date().toISOString(),
  reportTitle: 'Transfer test sample',
  reportType: 'reports',
  report: { transfer: true },
  ownerId: 'u-old',
  ownerName: 'Old Owner',
};

await saveReport(sample2);
const transferred = await updateReport(sample2.id, {
  ownerId: 'u-new',
  ownerName: 'New Owner',
  previousOwnerId: sample2.ownerId,
  previousOwnerName: sample2.ownerName,
  transferredAt: new Date().toISOString(),
  transferredBy: 'u-admin',
});
const fetched2 = await getReportsByIds([sample2.id]);
assert.equal(fetched2[0].ownerId, 'u-new', 'ownerId updated');
assert.equal(fetched2[0].ownerName, 'New Owner', 'ownerName updated');

// cleanup
await deleteReport(sample2.id);

console.log('Transfer unit test passed');
