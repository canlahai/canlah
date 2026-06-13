import { test, expect } from '@playwright/test';

// STEP 5 — legal/disclaimer page + footer link + per-reader disclaimers.
// Runs against the demo dev-server (baseURL from playwright.config).

test('/legal renders the disclaimer, data-handling and PDPA contact', async ({ page }) => {
  await page.goto('/legal');
  await expect(page).toHaveTitle(/Legal/i);
  await expect(page.locator('body')).toContainText(/qualified/i);
  await expect(page.locator('body')).toContainText(/PDPA/);
  await expect(page.locator('a[href^="mailto:hello@canlah.ai"]').first()).toBeVisible();
});

test('landing footer links to /legal', async ({ page }) => {
  await page.goto('/');
  const legal = page.locator('a[href="/legal"]').first();
  await expect(legal).toBeVisible();
});

for (const path of ['/site-report', '/hr-compliance', '/programme-planner', '/tender']) {
  test(`reader ${path} ships a results disclaimer linking to /legal`, async ({ request }) => {
    const html = await (await request.get(path)).text();
    expect(html).toMatch(/AI-generated draft/);
    expect(html).toMatch(/href="\/legal"/);
  });
}
