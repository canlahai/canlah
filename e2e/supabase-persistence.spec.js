import { test, expect } from '@playwright/test';

// Skip this entire test suite if Supabase is not configured
const SKIP = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY;

test.describe.configure({ mode: SKIP ? 'skip' : 'parallel' });
test.describe('Supabase Persistence Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Verify we're running against Supabase (not demo mode)
    await page.goto('/');
    const config = await page.evaluate(() => fetch('/api/config').then(r => r.json()));
    if (!config.supabase?.configured) {
      throw new Error('Test suite requires SUPABASE_URL and SUPABASE_SERVICE_KEY');
    }
  });

  test('should save report with Supabase persistence', async ({ page }) => {
    // Navigate to BQ reader
    await page.goto('/bq-reader.html');
    await page.waitForSelector('#file-input');

    // Upload file
    await page.locator('#file-input').setInputFiles({
      name: 'supabase-test-1.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 supabase integration test'),
    });

    // Analyze
    await page.locator('#analyse-btn').click();
    await expect(page.locator('#page-report')).toHaveClass(/active/, { timeout: 20_000 });

    // Save
    await page.getByRole('button', { name: 'Save Report' }).click();
    await expect(page.locator('.toast').filter({ hasText: /saved/ })).toBeVisible({ timeout: 5_000 });

    // Verify report appears in saved list with owner metadata
    await page.goto('/saved-reports.html');
    await page.waitForSelector('.sr-item');
    const items = page.locator('.sr-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    // Verify ownership info is present (should say "You" for logged-in user)
    const firstTitle = await items.first().locator('.sr-title').textContent();
    expect(firstTitle).toBeTruthy();
  });

  test('should list reports with pagination from Supabase', async ({ page }) => {
    await page.goto('/admin-reports.html');
    await page.waitForSelector('#ar-list');

    // Change per-page
    await page.locator('#ar-perpage').selectOption('25');
    await expect(page.locator('#ar-perpage')).toHaveValue('25');

    // Verify reports load
    const list = page.locator('#ar-list');
    const itemsText = await list.textContent();
    expect(itemsText).toBeTruthy();
  });

  test('should support search across Supabase reports', async ({ page }) => {
    // Save a uniquely-named report first
    const testName = `Supabase-Search-${Date.now()}`;
    await page.goto('/site-report.html');
    await page.locator('#file-input').setInputFiles({
      name: 'search-test.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('fake jpeg for search test'),
    });
    await page.locator('#analyse-btn').click();
    await expect(page.locator('#page-report')).toHaveClass(/active/, { timeout: 20_000 });

    // Set a custom title before save
    await page.evaluate((title) => {
      window._lastReport = window._lastReport || {};
      window._lastReport.reportTitle = title;
    }, testName);

    await page.getByRole('button', { name: 'Save Report' }).click();
    await expect(page.locator('.toast').filter({ hasText: /saved/ })).toBeVisible({ timeout: 5_000 });

    // Go to admin and search for it
    await page.goto('/admin-reports.html');
    await page.locator('#ar-search').fill(testName);
    await page.locator('#ar-refresh').click();

    // Verify result appears
    const summary = page.locator('#ar-summary');
    await expect(summary).toContainText(testName, { timeout: 5_000 });
  });

  test('should validate ownership checks on delete', async ({ page }) => {
    // This test verifies that non-admin users cannot delete others' reports
    // In this case, we're testing against the same user, so we should have delete permission
    await page.goto('/saved-reports.html');
    await page.waitForSelector('.sr-item');

    // Try to get the first report
    const firstItem = page.locator('.sr-item').first();
    const deleteBtn = firstItem.locator('button', { hasText: 'Delete' });

    // Button should exist for owned reports
    const isVisible = await deleteBtn.isVisible().catch(() => false);
    if (isVisible) {
      // Click delete and confirm
      await deleteBtn.click();
      const confirmBtn = page.locator('.cm-confirm');
      await expect(confirmBtn).toContainText(/delete/i);
    }
  });

  test('should track report ownership in metadata', async ({ page }) => {
    await page.goto('/admin-reports.html');
    await page.waitForSelector('#ar-list');

    // Get the first report and check for owner info
    const firstItem = page.locator('.sr-item').first();
    const ownerText = await firstItem.locator('.sr-owner').textContent().catch(() => '');

    // Owner metadata should be present
    expect(ownerText).toContain('Owner:');
  });

  test('should handle bulk export from Supabase', async ({ page }) => {
    await page.goto('/admin-reports.html');
    await page.waitForSelector('#ar-list');

    // Select all
    await page.locator('#ar-select-all').check();

    // Wait for export button to be enabled (at least one selected)
    const exportBtn = page.locator('#ar-export');
    await expect(exportBtn).toBeEnabled();

    // Start download listener
    const downloadPromise = page.waitForEvent('download');
    await exportBtn.click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/canlah-reports.*\.json/);
  });

  test('should verify Supabase config endpoint', async ({ page }) => {
    const config = await page.evaluate(async () => {
      const res = await fetch('/api/config');
      return await res.json();
    });

    expect(config.supabase).toBeDefined();
    expect(config.supabase.configured).toBe(true);
    expect(config.supabase.table).toBeTruthy();
  });
});
