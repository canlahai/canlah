import { test, expect } from '@playwright/test';

// UI error-state coverage: the upload zone must reject bad input with a visible
// error toast (not silently). Uses the demo-mode webServer; site-report wires
// CanLah.setupUploadZone({ accept: /\.(jpe?g|png|pdf)$/i }).

test('unsupported file type → error toast', async ({ page }) => {
  await page.goto('/site-report.html');
  await page.locator('#file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image or pdf'),
  });
  const toast = page.locator('#toast');
  await expect(toast).toHaveClass(/show/);
  await expect(toast).toHaveClass(/err/);
  await expect(toast).toContainText(/unsupported file type/i);
  // and the upload must NOT have advanced to the "selected" state
  await expect(page.locator('#upload-selected')).toBeHidden();
});

test('oversized file (>30MB) → error toast', async ({ page }) => {
  await page.goto('/site-report.html');
  await page.locator('#file-input').setInputFiles({
    name: 'huge.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(31 * 1024 * 1024, 1), // valid type, over the 30MB cap
  });
  const toast = page.locator('#toast');
  await expect(toast).toHaveClass(/err/);
  await expect(toast).toContainText(/maximum 30mb/i);
  await expect(page.locator('#upload-selected')).toBeHidden();
});
