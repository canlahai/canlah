import { test, expect } from '@playwright/test';

// Safety Report generator (/safety-report) in demo mode: a worker types rough
// notes → a professional report renders (demo sample echoes the notes).

test('safety report: rough notes → generated professional report', async ({ page }) => {
  await page.goto('/safety-report');
  await expect(page.locator('h1')).toContainText('Safety report');

  // Report type options populated from lib/safety.
  await expect(page.locator('#rtype option')).not.toHaveCount(0);
  await page.selectOption('#rtype', 'near-miss');

  // An example chip fills the notes box.
  await page.locator('#examples .chip').first().click();
  await expect(page.locator('#notes')).not.toHaveValue('');

  // Type the worker's broken-English notes and generate.
  await page.fill('#notes', 'brick drop from level 5, nobody hurt, area barricade already');
  await page.click('#go');

  // The generated report renders with a title + section headings.
  await expect(page.locator('#report')).toBeVisible();
  await expect(page.locator('#report .rp-title')).toContainText('Near-miss');
  await expect(page.locator('#report .rp-sec')).not.toHaveCount(0);
  await expect(page.locator('#report')).toContainText('brick drop from level 5'); // demo echoes the notes
  await expect(page.locator('#report-actions')).toBeVisible();
});

test('safety report: empty notes is rejected', async ({ page }) => {
  await page.goto('/safety-report');
  await page.click('#go');
  await expect(page.locator('#report')).toBeHidden();
});
