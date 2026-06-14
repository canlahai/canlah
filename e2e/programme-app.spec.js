import { test, expect } from '@playwright/test';

// STEP 6b — the /programme app, driven in the browser against the demo dev-server
// (pro-gate bypassed in DEMO_MODE). Creates a programme, edits the activity tree,
// checks the Gantt renders a critical path, saves, then deletes to stay tidy.

test('programme planner: create → edit tree → Gantt → save → delete', async ({ page }) => {
  await page.goto('/programme');

  // Pro gate is open in demo mode → project list, not the upsell.
  await expect(page.locator('#view-list')).toBeVisible();
  await expect(page.locator('#view-gate')).toBeHidden();

  // Create a programme.
  await page.fill('#np-name', 'E2E Planner');
  await page.fill('#np-start', '2026-07-01');
  await page.click('#np-create');

  await expect(page.locator('#view-editor')).toBeVisible();
  await expect(page.locator('#ed-name')).toHaveText('E2E Planner');

  // Add two activities.
  await page.click('#ed-add');
  await page.click('#ed-add');
  const rows = page.locator('#act-body tr');
  await expect(rows).toHaveCount(2);

  // Set durations and a finish-to-start dependency (a2 follows a1).
  await rows.nth(0).locator('td.dur input').fill('10');
  await rows.nth(1).locator('td.dur input').fill('5');
  await rows.nth(1).locator('td').nth(5).locator('input').fill('a1');
  await rows.nth(1).locator('td').nth(5).locator('input').blur();

  // Schedule recomputes (debounced) → project end + critical path populate.
  await expect(page.locator('#st-count')).toHaveText('2');
  await expect(page.locator('#st-end')).not.toHaveText('—');
  await expect(page.locator('#st-crit')).not.toHaveText('—');

  // Gantt drew at least one critical (orange) bar.
  await expect(page.locator('#gantt .bar.crit').first()).toBeVisible();

  // Save.
  await page.click('#ed-save');
  await expect(page.locator('#toast')).toContainText('Saved');

  // Back to the list shows the card.
  await page.click('#ed-back');
  await expect(page.locator('#list-cards')).toContainText('E2E Planner');

  // Reopen and delete (auto-accept the confirm dialog).
  await page.locator('.pcard', { hasText: 'E2E Planner' }).first().click();
  await expect(page.locator('#view-editor')).toBeVisible();
  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});
