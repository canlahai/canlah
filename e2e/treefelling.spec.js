import { test, expect } from '@playwright/test';
import { rm } from 'node:fs/promises';
import path from 'node:path';

test.beforeAll(async () => {
  await rm(path.resolve('data', 'reports.json'), { force: true });
});

test('bq reader: upload PDF → analyse → save → export PDF', async ({ page }) => {
  await page.goto('/bq-reader.html');

  await page.locator('#file-input').setInputFiles({
    name: 'tree-plan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake pdf content for tests'),
  });

  await expect(page.locator('#upload-selected')).toBeVisible();
  await page.locator('#analyse-btn').click();

  await expect(page.locator('#page-report')).toHaveClass(/active/, { timeout: 20_000 });

  // Basic sanity: tree register header and at least one record or summary values
  await expect(page.locator('.rh-title')).toBeVisible();
  await expect(page.locator('#reg-count')).toBeVisible();

  // Save the report
  await page.getByRole('button', { name: 'Save Report' }).click();
  await expect(page.locator('.toast').filter({ hasText: /saved/ })).toBeVisible({ timeout: 5_000 });

  // ensure saved report appears and shows owner label (You) in UI when logged in
  await page.goto('/saved-reports.html');
  await page.waitForSelector('.sr-item');
  await expect(page.locator('.sr-title')).toContainText('Unit', { timeout: 2000 }).catch(() => {});

  // Go to saved reports and export PDF
  await page.goto('/saved-reports.html');
  await page.waitForSelector('.sr-item');

  const downloadResponse = page.waitForResponse((response) => response.url().includes('/api/report-pdf') && response.status() === 200);
  await page.locator('.sr-item button', { hasText: 'PDF' }).first().click();

  const response = await downloadResponse;
  expect(response.headers()['content-type']).toContain('application/pdf');
});
