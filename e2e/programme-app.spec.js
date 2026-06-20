import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

  // Back to the list shows the programme on the portfolio dashboard.
  await page.click('#ed-back');
  await expect(page.locator('#pf-body')).toContainText('E2E Planner');

  // Reopen from the dashboard row and delete (auto-accept the confirm dialog).
  await page.locator('#pf-body tr', { hasText: 'E2E Planner' }).first().click();
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

  // Sign off the first item → records who signed it off (sign-off-by-role).
  await page.locator('#ac-checklist .mrow').first().locator('button[data-i]').click();
  await expect(page.locator('#ac-checklist .mrow').first()).toContainText('signed off by');

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
  // Table populates async (during recompute) — poll until rows render.
  await expect.poll(() => page.locator('#act-body tr').count(), { timeout: 8000 }).toBeGreaterThan(15); // ~18 standard + 8 floors
  await expect(page.locator('#gantt .bar').first()).toBeVisible();
  await expect(page.locator('#st-crit')).not.toHaveText('—');
  await expect(page.locator('#st-crit')).not.toHaveText('0');

  // Has the SG regulatory gates (e.g. TOP) — Gantt labels render names as text.
  await expect(page.locator('#gantt')).toContainText('TOP');

  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('portfolio dashboard: roll-up, progress + risk stats, card toggle', async ({ page }) => {
  await page.goto('/programme');

  // Create a programme with two activities and mark one blocked → at-risk.
  await page.fill('#np-name', 'Portfolio One');
  await page.fill('#np-start', '2026-07-01');
  await page.click('#np-create');
  await expect(page.locator('#view-editor')).toBeVisible();
  await page.click('#ed-add');
  await page.click('#ed-add');
  await expect(page.locator('#act-body tr')).toHaveCount(2);
  // Block the first activity via the detail panel.
  await page.locator('#act-body tr').first().locator('.plan-btn').click();
  await expect(page.locator('#activity-modal')).toBeVisible();
  await page.selectOption('#ac-status', 'blocked');
  await page.fill('#ac-resp', 'Procurement');
  await page.click('#ac-save');
  await page.click('#ac-close');
  await page.click('#ed-save');
  await page.click('#ed-back');

  // Dashboard is the default list view: row + roll-up reflect the data.
  await expect(page.locator('#portfolio-panel')).toBeVisible();
  await expect(page.locator('#pf-rollup')).toContainText('programme');
  const row = page.locator('#pf-body tr', { hasText: 'Portfolio One' }).first();
  await expect(row).toContainText('% ·');           // progress cell
  await expect(row.locator('.risk-pill')).toContainText('1'); // one at-risk (blocked)

  // Toggle to Cards and back.
  await page.click('#seg-cards');
  await expect(page.locator('#list-cards')).toBeVisible();
  await expect(page.locator('#portfolio-panel')).toBeHidden();
  await page.click('#seg-dash');
  await expect(page.locator('#portfolio-panel')).toBeVisible();

  // Open from the dashboard row, then clean up.
  await row.click();
  await expect(page.locator('#view-editor')).toBeVisible();
  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('directory: add a contact, it appears, then remove it', async ({ page }) => {
  await page.goto('/programme');
  await expect(page.locator('#view-list')).toBeVisible();
  const email = `dir-${Date.now()}@firm.sg`;

  await page.click('#open-directory');
  await expect(page.locator('#directory-modal')).toBeVisible();
  await page.fill('#dir-email', email);
  await page.fill('#dir-name', 'Ah Seng');
  await page.fill('#dir-company', 'Colour Low');
  await page.selectOption('#dir-trade', 'subcon');
  await page.click('#dir-add');

  await expect(page.locator('#dir-list')).toContainText('Ah Seng');
  await expect(page.locator('#dir-list')).toContainText(email);

  // Remove (no confirm dialog on contact delete).
  await page.locator('#dir-list .mrow', { hasText: 'Ah Seng' }).locator('.row-x').click();
  await expect(page.locator('#dir-list')).not.toContainText(email);
});

test('multi-programme: look-ahead + resources + master with a cross-project link', async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  const tag = String(Date.now()).slice(-5);
  const nameA = `MP Alpha ${tag}`, nameB = `MP Beta ${tag}`;

  // Helper: create a programme with one assigned, dated activity. Returns in list view.
  async function makeProgramme(name, actName) {
    await page.goto('/programme');
    await page.fill('#np-name', name);
    await page.fill('#np-start', today);
    await page.click('#np-create');
    await expect(page.locator('#view-editor')).toBeVisible();
    await page.click('#ed-add');
    const row = page.locator('#act-body tr').first();
    await row.locator('td.name input').fill(actName);
    await row.locator('td.dur input').fill('5');
    await row.locator('td').nth(6).locator('input').fill('Ah Seng'); // assignee column
  }

  // Programme A — fully saved (so it can be a link target).
  await makeProgramme(nameA, 'Alpha pour');
  await page.click('#ed-save');
  await page.click('#ed-back');
  await expect(page.locator('#pf-body')).toContainText(nameA); // pfCache now holds A

  // Programme B — depends on A's activity (cross-project link).
  await makeProgramme(nameB, 'Beta deck');
  await page.locator('#act-body tr').first().locator('.plan-btn').click();
  await expect(page.locator('#activity-modal')).toBeVisible();
  await page.selectOption('#dep-prog', { label: nameA });
  await expect(page.locator('#dep-act option', { hasText: 'Alpha pour' })).toHaveCount(1);
  await page.selectOption('#dep-act', { label: 'Alpha pour' });
  await page.click('#dep-add');
  await expect(page.locator('#ac-deps')).toContainText('Alpha pour');
  await page.click('#ac-close');
  await page.click('#ed-save'); // persists assignee + externalDeps
  await page.click('#ed-back');

  // Look-ahead: both activities land in the 3-week window.
  await page.click('#seg-lookahead');
  await expect(page.locator('#lookahead-panel')).toBeVisible();
  await expect(page.locator('#la-body')).toContainText('Alpha pour');
  await expect(page.locator('#la-body')).toContainText('Beta deck');

  // Resources: Ah Seng committed on both → flagged as a double-booking.
  await page.click('#seg-resources');
  await expect(page.locator('#resources-panel')).toBeVisible();
  await expect(page.locator('#res-body')).toContainText('Ah Seng');
  await expect(page.locator('#res-summary')).toContainText('double-booking');
  await expect(page.locator('#res-body .res-clash')).toHaveCount(1);

  // Master: both programmes on the timeline + a breached cross-project link.
  await page.click('#seg-master');
  await expect(page.locator('#master-panel')).toBeVisible();
  await expect(page.locator('#mp-timeline')).toContainText(nameA);
  await expect(page.locator('#mp-timeline')).toContainText(nameB);
  await expect(page.locator('#mp-links')).toContainText('Alpha pour');
  await expect(page.locator('#mp-links .lk-breached')).toHaveCount(1);

  // Auto re-flow proposes pushing the dependent programme; applying clears the breach.
  await expect(page.locator('#mp-reflow-wrap')).toBeVisible();
  await expect(page.locator('#mp-reflow')).toContainText(nameB);
  await page.locator('#mp-reflow [data-apply]').first().click();
  await expect(page.locator('#mp-links .lk-breached')).toHaveCount(0);
  await expect(page.locator('#mp-reflow-wrap')).toBeHidden();

  // Cleanup both programmes.
  page.on('dialog', (d) => d.accept());
  for (const nm of [nameA, nameB]) {
    await page.click('#seg-dash');
    await page.locator('#pf-body tr', { hasText: nm }).first().click();
    await expect(page.locator('#view-editor')).toBeVisible();
    await page.click('#ed-delete');
    await expect(page.locator('#view-list')).toBeVisible();
  }
});

test('attention inbox: a blocked activity surfaces with a badge', async ({ page }) => {
  const tag = String(Date.now()).slice(-5);
  await page.goto('/programme');
  await page.fill('#np-name', `Attn ${tag}`);
  await page.fill('#np-start', '2026-07-01');
  await page.click('#np-create');
  await expect(page.locator('#view-editor')).toBeVisible();
  await page.click('#ed-add');
  const row = page.locator('#act-body tr').first();
  await row.locator('td.name input').fill('Cast slab');
  await row.locator('.plan-btn').click();
  await expect(page.locator('#activity-modal')).toBeVisible();
  await page.selectOption('#ac-status', 'blocked');
  await page.fill('#ac-resp', 'Procurement');
  await page.fill('#ac-blocked', 'rebar late');
  await page.click('#ac-save');
  await page.click('#ac-close');
  await page.click('#ed-save');
  await page.click('#ed-back');

  // Bell badge appears; inbox lists the blocked item with its reason.
  await expect(page.locator('#attn-badge')).toBeVisible();
  await page.click('#open-attention');
  await expect(page.locator('#attention-modal')).toBeVisible();
  await expect(page.locator('#attn-body')).toContainText('Cast slab');
  await expect(page.locator('#attn-body')).toContainText('rebar late');
  await page.click('#attn-close');

  // Cleanup.
  page.on('dialog', (d) => d.accept());
  await page.click('#seg-dash');
  await page.locator('#pf-body tr', { hasText: `Attn ${tag}` }).first().click();
  await expect(page.locator('#view-editor')).toBeVisible();
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
  await expect.poll(() => page.locator('#act-body tr').count(), { timeout: 8000 }).toBeGreaterThan(5); // demo scope has 10 items
  await expect(page.locator('#gantt .bar').first()).toBeVisible();
  await expect(page.locator('#st-crit')).not.toHaveText('0');

  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('programme overview: read-friendly status summary + toggle', async ({ page }) => {
  await page.goto('/programme');
  await page.fill('#np-name', 'Overview test');
  await page.fill('#np-start', '2026-07-01');
  await page.click('#np-create');
  await expect(page.locator('#view-editor')).toBeVisible();
  // Editors land on Schedule.
  await expect(page.locator('#ed-schedule')).toBeVisible();
  await page.click('#ed-add');
  const row = page.locator('#act-body tr').first();
  await row.locator('td.name input').fill('Foundations');
  await row.locator('td.dur input').fill('10');
  await row.locator('select').selectOption('in_progress');

  // Switch to Overview → status summary renders.
  await page.click('#ed-seg-overview');
  await expect(page.locator('#ed-overview')).toBeVisible();
  await expect(page.locator('#ed-schedule')).toBeHidden();
  await expect(page.locator('#ed-overview')).toContainText('Progress');
  await expect(page.locator('#ed-overview')).toContainText('By phase');
  await expect(page.locator('#ed-overview')).toContainText('In progress now');
  await expect(page.locator('#ed-overview')).toContainText('Foundations');

  // Toggle back to Schedule.
  await page.click('#ed-seg-schedule');
  await expect(page.locator('#act-body')).toBeVisible();
  await expect(page.locator('#ed-overview')).toBeHidden();

  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('export to MS Project XML → downloads valid MSPDI', async ({ page }) => {
  await page.goto('/programme');
  await page.fill('#np-name', 'MSP export test');
  await page.fill('#np-start', '2026-07-01');
  await page.click('#np-create');
  await expect(page.locator('#view-editor')).toBeVisible();
  await page.click('#ed-add');
  await page.click('#ed-add');
  const rows = page.locator('#act-body tr');
  await expect(rows).toHaveCount(2);
  await rows.nth(0).locator('td.dur input').fill('10');
  await rows.nth(1).locator('td.dur input').fill('5');
  await rows.nth(1).locator('td').nth(5).locator('input').fill('a1');
  await rows.nth(1).locator('td').nth(5).locator('input').blur();
  // Wait for the dependency to commit to state (input is debounced) before export.
  await expect.poll(() => page.evaluate(() => state.activities[1].predecessors.length)).toBeGreaterThan(0);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#ed-msp'),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xml$/);
  const xml = readFileSync(await download.path(), 'utf8');
  expect(xml).toContain('<Project');
  expect(xml).toContain('schemas.microsoft.com/project');
  expect(xml).toContain('<PredecessorLink>'); // the a2→a1 dependency exported

  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('import a CSV plan → preview → create programme', async ({ page }) => {
  const tag = String(Date.now()).slice(-5);
  const name = `Imported ${tag}`;
  await page.goto('/programme');
  await page.click('#np-import');
  await expect(page.locator('#import-modal')).toBeVisible();
  await page.fill('#imp-name', name);
  await page.fill('#imp-start', '2026-07-01');
  await page.setInputFiles('#imp-file', {
    name: 'plan.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Name,Duration (days),Predecessors\nExcavation,10,\nFoundations,15,1\nColumns,12,2'),
  });
  await page.click('#imp-read');
  await expect(page.locator('#imp-preview')).toBeVisible();
  await expect(page.locator('#imp-preview')).toContainText('Read 3 tasks');
  await expect(page.locator('#imp-preview')).toContainText('Excavation');
  await page.click('#imp-create');

  await expect(page.locator('#view-editor')).toBeVisible();
  await expect.poll(() => page.locator('#act-body tr').count(), { timeout: 8000 }).toBe(3);
  await expect(page.locator('#gantt .bar').first()).toBeVisible();

  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('export to Primavera P6 (XER) → downloads valid XER', async ({ page }) => {
  await page.goto('/programme');
  await page.fill('#np-name', 'P6 export test');
  await page.fill('#np-start', '2026-07-01');
  await page.click('#np-create');
  await expect(page.locator('#view-editor')).toBeVisible();
  await page.click('#ed-add');
  await page.locator('#act-body tr').first().locator('td.dur input').fill('8');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#ed-p6')]);
  expect(download.suggestedFilename()).toMatch(/\.xer$/);
  const xer = readFileSync(await download.path(), 'utf8');
  expect(xer).toMatch(/^ERMHDR/);
  expect(xer).toContain('%T\tTASK');
  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('import a Primavera P6 XER → preview → create programme', async ({ page }) => {
  const xer = [
    'ERMHDR\t19.12\t2026-06-20\tProject\tCanLah\tCanLah\tCanLah\tUSD',
    '%T\tTASK',
    '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt',
    '%R\t1001\t1\tA1010\tExcavation\t80',
    '%R\t1002\t1\tA1020\tFoundations\t120',
    '%T\tTASKPRED',
    '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt',
    '%R\t5001\t1002\t1001\t1\t1\tPR_FS\t0',
    '%E', '',
  ].join('\n');
  await page.goto('/programme');
  await page.click('#np-import');
  await expect(page.locator('#import-modal')).toBeVisible();
  await page.fill('#imp-start', '2026-07-01');
  await page.setInputFiles('#imp-file', { name: 'plan.xer', mimeType: 'text/plain', buffer: Buffer.from(xer) });
  await page.click('#imp-read');
  await expect(page.locator('#imp-preview')).toContainText('Read 2 tasks');
  await expect(page.locator('#imp-preview')).toContainText('Excavation');
  await page.click('#imp-create');
  await expect(page.locator('#view-editor')).toBeVisible();
  await expect.poll(() => page.locator('#act-body tr').count(), { timeout: 8000 }).toBe(2);

  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});

test('build from BQ → quantities → estimated-duration programme', async ({ page }) => {
  await page.goto('/programme');
  await page.click('#np-bq');
  await expect(page.locator('#bq-modal')).toBeVisible();
  await page.fill('#bq-start', '2026-07-01');
  await page.setInputFiles('#bq-file', { name: 'bq.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 bill of quantities') });
  await page.click('#bq-go');

  // Lands in the editor populated from the (demo) BQ with computed durations.
  await expect(page.locator('#view-editor')).toBeVisible();
  await expect.poll(() => page.locator('#act-body tr').count(), { timeout: 8000 }).toBeGreaterThan(8); // 13 items, 1 skipped
  await expect(page.locator('#gantt .bar').first()).toBeVisible();
  await expect(page.locator('#st-crit')).not.toHaveText('0');
  // Every activity got a non-zero duration from the productivity rates.
  const firstDur = await page.locator('#act-body tr').first().locator('td.dur input').inputValue();
  expect(Number(firstDur)).toBeGreaterThan(0);

  page.on('dialog', (d) => d.accept());
  await page.click('#ed-delete');
  await expect(page.locator('#view-list')).toBeVisible();
});
