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

test('collaborative activity: checklist template + blocked → readiness flags', async ({ page }) => {
  await page.goto('/programme');
  await page.fill('#np-name', 'Collab UI');
  await page.fill('#np-start', '2026-07-01');
  await page.click('#np-create');
  await expect(page.locator('#view-editor')).toBeVisible();

  // Add an activity and name it so the template matcher picks "concrete casting".
  await page.click('#ed-add');
  const row = page.locator('#act-body tr').first();
  await row.locator('td.name input').fill('Cast slab L3');

  // Open the activity detail panel via the Plan badge.
  await row.locator('.plan-btn').click();
  await expect(page.locator('#activity-modal')).toBeVisible();

  // Suggest a checklist from the activity name → concrete template populates.
  await page.click('#ck-suggest');
  await expect(page.locator('#ac-checklist .mrow').first()).toBeVisible();
  const items = await page.locator('#ac-checklist .mrow').count();
  expect(items).toBeGreaterThan(3);

  // Mark blocked with a responsible party, add an update, save.
  await page.selectOption('#ac-status', 'blocked');
  await page.fill('#ac-resp', 'Procurement');
  await page.fill('#ac-note', 'Concrete delivery delayed');
  await page.click('#ac-save');
  await expect(page.locator('#toast')).toContainText('updated');

  // Update log now shows the attributed entry.
  await expect(page.locator('#ac-updates')).toContainText('Concrete delivery delayed');
  await page.click('#ac-close');

  // Table badge reflects blocked; the At-risk stat is non-zero.
  await expect(page.locator('#act-body tr').first().locator('.plan-btn')).toContainText('Blocked');
  await expect(page.locator('#st-risk')).not.toHaveText('0');

  // Programme-wide activity log shows the update.
  await page.click('#ed-feed');
  await expect(page.locator('#feed-list')).toContainText('Concrete delivery delayed');
  await expect(page.locator('#feed-list')).toContainText('Cast slab L3');
  await page.click('#feed-close');

  // Readiness filter narrows to at-risk activities.
  await page.selectOption('#f-risk', 'atrisk');
  await expect(page.locator('#act-body tr')).toHaveCount(1);

  // Cleanup.
  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('modals close on Escape and on backdrop click', async ({ page }) => {
  await page.goto('/programme');
  await page.fill('#np-name', 'Modal Test');
  await page.fill('#np-start', '2026-07-01');
  await page.click('#np-create');
  await expect(page.locator('#view-editor')).toBeVisible();

  // Escape closes the members modal.
  await page.click('#ed-members');
  await expect(page.locator('#member-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#member-modal')).toBeHidden();

  // Backdrop click closes it (click the overlay near the corner, not the panel).
  await page.click('#ed-members');
  await expect(page.locator('#member-modal')).toBeVisible();
  await page.click('#member-modal', { position: { x: 6, y: 6 } });
  await expect(page.locator('#member-modal')).toBeHidden();

  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('generate from profile → full SG programme as a collaborative schedule', async ({ page }) => {
  await page.goto('/programme');
  await page.click('#np-generate');
  await expect(page.locator('#gen-modal')).toBeVisible();
  await page.fill('#gen-name', 'Generated Tower');
  await page.fill('#gen-start', '2026-07-01');
  await page.fill('#gen-storeys', '8');
  await page.click('#gen-go');

  // Lands in the editor with a generated activity set + computed critical path.
  await expect(page.locator('#view-editor')).toBeVisible();
  await expect(page.locator('#ed-name')).toHaveText('Generated Tower');
  const rows = await page.locator('#act-body tr').count();
  expect(rows).toBeGreaterThan(15); // ~14 standard + 8 floors
  await expect(page.locator('#gantt .bar').first()).toBeVisible();
  await expect(page.locator('#st-crit')).not.toHaveText('—');
  await expect(page.locator('#st-crit')).not.toHaveText('0');

  // Has the SG regulatory gates (e.g. TOP) — Gantt labels render names as text.
  await expect(page.locator('#gantt')).toContainText('TOP');

  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('upload scope-of-works → AI reads works + durations → programme', async ({ page }) => {
  await page.goto('/programme');
  await page.click('#np-scope');
  await expect(page.locator('#scope-modal')).toBeVisible();
  await page.fill('#scope-start', '2026-07-01');
  await page.setInputFiles('#scope-file', { name: 'scope.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 scope of works') });
  await page.click('#scope-go');

  // Lands in the editor populated from the (demo) extracted scope.
  await expect(page.locator('#view-editor')).toBeVisible();
  const rows = await page.locator('#act-body tr').count();
  expect(rows).toBeGreaterThan(5); // demo scope has 10 items
  await expect(page.locator('#gantt .bar').first()).toBeVisible();
  await expect(page.locator('#st-crit')).not.toHaveText('0');

  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});
