import { test, expect } from '@playwright/test';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const DEMO_COMPANY = 'Acme Construction Pte Ltd';

test.beforeAll(async () => {
  await rm(path.resolve('data', 'reports.json'), { force: true });
});

test('hr compliance: upload → analyse → save → list', async ({ page }) => {
  await page.goto('/hr-compliance.html');

  await page.locator('#file-input').setInputFiles({
    name: 'q1-roster.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake roster bytes'),
  });

  await expect(page.locator('#upload-selected')).toBeVisible();
  await page.locator('#analyse-btn').click();

  await expect(page.locator('#page-report')).toHaveClass(/active/, { timeout: 20_000 });
  await expect(page.locator('#r-company')).toHaveText(DEMO_COMPANY);

  // Vitals + sections
  await expect(page.locator('#r-vitals .vital')).toHaveCount(4);
  await expect(page.locator('#r-drc-section')).toHaveClass(/alert/);
  await expect(page.locator('#r-expiring tbody tr').first()).toBeVisible();
  await expect(page.locator('#r-missing tbody tr').first()).toBeVisible();

  // Save & list
  await page.getByRole('button', { name: 'Save Report' }).click();
  await expect(page.locator('.toast').filter({ hasText: /Compliance report saved/ })).toBeVisible({ timeout: 5_000 });

  await page.getByRole('button', { name: 'Saved Reports' }).click();
  const panel = page.locator('#saved-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.sr-title').filter({ hasText: DEMO_COMPANY })).toBeVisible();
});
