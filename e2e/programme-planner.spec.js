import { test, expect } from '@playwright/test';
import { rm } from 'node:fs/promises';
import path from 'node:path';

const DEMO_PROJECT = 'Construction of HDB EW2 Connection — Blk 102';

test.beforeAll(async () => {
  await rm(path.resolve('data', 'reports.json'), { force: true });
});

test('programme planner: upload → analyse → Gantt → save → list', async ({ page }) => {
  await page.goto('/programme-planner.html');

  await page.locator('#file-input').setInputFiles({
    name: 'programme.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake programme'),
  });

  await expect(page.locator('#upload-selected')).toBeVisible();
  await page.locator('#analyse-btn').click();

  await expect(page.locator('#page-report')).toHaveClass(/active/, { timeout: 20_000 });
  await expect(page.locator('#r-project')).toHaveText(DEMO_PROJECT);

  // Vitals (5 stats: duration, phases, tasks, milestones, critical path)
  await expect(page.locator('#r-vitals .vital')).toHaveCount(5);

  // Gantt rendered: header + phase rows + task rows
  await expect(page.locator('#r-gantt .gantt-header')).toBeVisible();
  await expect(page.locator('#r-gantt .gantt-row.phase-row')).toHaveCount(5);
  await expect(page.locator('#r-gantt .gantt-bar').first()).toBeVisible();

  // Critical path bars rendered with .critical class
  await expect(page.locator('#r-gantt .gantt-bar.critical').first()).toBeVisible();

  // Milestone diamonds rendered
  await expect(page.locator('#r-gantt .gantt-milestone').first()).toBeVisible();

  // Save & list
  await page.getByRole('button', { name: 'Save Report' }).click();
  await expect(page.locator('.toast').filter({ hasText: /Programme saved/ })).toBeVisible({ timeout: 5_000 });

  await page.getByRole('button', { name: 'Saved Reports' }).click();
  const panel = page.locator('#saved-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.sr-title').filter({ hasText: DEMO_PROJECT })).toBeVisible();
});
