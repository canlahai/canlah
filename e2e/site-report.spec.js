import { test, expect } from '@playwright/test';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const DEMO_SITE_NAME = 'Pioneer Road Viaduct — Pier 12';

test.beforeAll(async () => {
  await rm(path.resolve('data', 'reports.json'), { force: true });
});

test('site report: upload → analyse → save → list', async ({ page }) => {
  await page.goto('/site-report.html');

  await page.locator('#file-input').setInputFiles({
    name: 'site-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from('fake jpeg bytes for demo mode'),
  });

  await expect(page.locator('#upload-selected')).toBeVisible();
  await page.locator('#analyse-btn').click();

  await expect(page.locator('#page-report')).toHaveClass(/active/, { timeout: 20_000 });
  await expect(page.locator('#r-site')).toHaveText(DEMO_SITE_NAME);

  // Vitals rendered
  await expect(page.locator('#r-vitals .vital')).toHaveCount(4);

  // Safety section visible with at least one alert
  await expect(page.locator('#r-safety')).toBeVisible();
  await expect(page.locator('#r-safety-list li').first()).toBeVisible();

  // Save & list
  await page.getByRole('button', { name: 'Save Report' }).click();
  await expect(page.locator('.toast').filter({ hasText: /Site report saved/ })).toBeVisible({ timeout: 5_000 });

  await page.getByRole('button', { name: 'Saved Reports' }).click();
  const panel = page.locator('#saved-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.sr-title').filter({ hasText: DEMO_SITE_NAME })).toBeVisible();
});
