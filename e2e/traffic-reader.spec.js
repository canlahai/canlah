import { test, expect } from '@playwright/test';

// Traffic plan reading is now a doc-type inside the unified /bq-reader. Demo mode:
// the page skips the real browser→Blob upload and the server returns sample
// traffic data → charts render. (Real large-file upload runs outside CI.)
test('bq-reader (traffic): ?type=traffic → upload (demo) → traffic charts', async ({ page }) => {
  await page.goto('/bq-reader.html?type=traffic');

  // selector preselected to traffic
  await expect(page.locator('.doctype-chip[data-type="traffic"]')).toHaveClass(/active/);

  await page.locator('#file-input').setInputFiles({
    name: 'traffic-survey.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake traffic report for demo'),
  });
  await page.locator('#analyse-btn').click();

  // traffic report shows; tree report hidden
  await expect(page.locator('#traffic-report')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#page-report .report-screen')).toBeHidden();
  await expect(page.locator('#tr-locations .tr-loc')).toHaveCount(3);
  await expect(page.locator('#tr-summary')).toContainText(/Total Vehicles/i);
  await expect(page.locator('#tr-locations .tr-loc').first().locator('.tr-bars .bar').first()).toBeVisible();
});

test('default doc type is tree (charts hidden until traffic chosen)', async ({ page }) => {
  await page.goto('/bq-reader.html');
  await expect(page.locator('.doctype-chip[data-type="tree"]')).toHaveClass(/active/);
});

test('old /traffic-bq-reader.html redirects to the unified reader', async ({ page }) => {
  await page.goto('/traffic-bq-reader.html');
  await page.waitForURL(/\/bq-reader\.html\?type=traffic/, { timeout: 5000 });
});
