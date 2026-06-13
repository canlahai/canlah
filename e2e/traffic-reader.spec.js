import { test, expect } from '@playwright/test';

// Traffic reader, demo mode: the page skips the real browser→Blob upload and the
// server returns sample traffic data → charts render. (The real large-file upload
// path is the @vercel/blob client + /api/upload-token, exercised outside CI.)
test('traffic reader: upload PDF (demo) → renders traffic locations + charts', async ({ page }) => {
  await page.goto('/traffic-bq-reader.html');

  await page.locator('#file-input').setInputFiles({
    name: 'traffic-survey.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake traffic report for demo'),
  });

  await expect(page.locator('#results')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.location-card')).toHaveCount(3);
  await expect(page.locator('#summary-grid')).toContainText(/Total Vehicles/i);
  // each location renders an hourly bar chart
  await expect(page.locator('.location-card').first().locator('.bar-chart .bar').first()).toBeVisible();
});

test('traffic reader: rejects a non-PDF file', async ({ page }) => {
  await page.goto('/traffic-bq-reader.html');
  await page.locator('#file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a pdf'),
  });
  await expect(page.locator('#status')).toContainText(/please upload a pdf/i);
  await expect(page.locator('#results')).toBeHidden();
});
