import { test, expect } from '@playwright/test';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const DEMO_PROJECT_NAME = 'Construction of Road Viaduct Along Pioneer Road';

test.beforeAll(async () => {
  await rm(path.resolve('data', 'reports.json'), { force: true });
});

test('upload → analyse → save → list', async ({ page }) => {
  await page.goto('/bq-reader.html');

  await page.locator('#file-input').setInputFiles({
    name: 'fake-drawing.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake bytes for demo mode'),
  });

  await expect(page.locator('#upload-selected')).toBeVisible();
  await page.locator('#analyse-btn').click();

  await expect(page.locator('#page-report')).toHaveClass(/active/, { timeout: 20_000 });
  await expect(page.locator('#r-title')).toHaveText(DEMO_PROJECT_NAME);

  await page.getByRole('button', { name: 'Save Report' }).click();
  await expect(page.locator('.toast').filter({ hasText: /Report saved/ })).toBeVisible({ timeout: 5_000 });

  await page.getByRole('button', { name: 'Saved Reports' }).click();
  const panel = page.locator('#saved-reports-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.sr-title').filter({ hasText: DEMO_PROJECT_NAME })).toBeVisible();
});
