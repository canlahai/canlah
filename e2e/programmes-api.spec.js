import { test, expect } from '@playwright/test';

// STEP 6 — Programme Planner API, exercised against the demo dev-server (auth +
// pro-gate bypassed in DEMO_MODE). Covers the CRUD happy path + validation, and
// cleans up the programme it creates so data/programmes.json stays tidy.

test('programme CRUD: create → list → get → update → delete', async ({ request }) => {
  const startDate = '2026-07-01';
  const activities = [
    { id: 'a1', name: 'Piling', trade: 'Substructure', durationDays: 10, predecessors: [] },
    { id: 'a2', name: 'Pile cap', trade: 'Substructure', durationDays: 5, predecessors: [{ id: 'a1' }] },
  ];

  const created = await request.post('/api/programmes', { data: { name: 'E2E Tower', startDate, activities } });
  expect(created.status()).toBe(200);
  const { programme } = await created.json();
  expect(programme.role).toBe('pm');
  expect(programme.id).toBeTruthy();
  const id = programme.id;

  try {
    const list = await (await request.get('/api/programmes')).json();
    const row = list.programmes.find((p) => p.id === id);
    expect(row).toBeTruthy();
    expect(row.activityCount).toBe(2);
    expect('activities' in row).toBe(false);

    const one = await (await request.get(`/api/programmes?id=${id}`)).json();
    expect(one.programme.activities.length).toBe(2);
    expect(Array.isArray(one.programme.members)).toBe(true);

    const upd = await request.patch('/api/programmes', {
      data: { id, name: 'E2E Tower (rev)', activities: [{ id: 'a1', name: 'Piling', durationDays: 12, predecessors: [] }] },
    });
    expect(upd.status()).toBe(200);
    const after = await (await request.get(`/api/programmes?id=${id}`)).json();
    expect(after.programme.name).toBe('E2E Tower (rev)');
    expect(after.programme.activities.length).toBe(1);
  } finally {
    const del = await request.delete('/api/programmes', { data: { id } });
    expect(del.status()).toBe(200);
    const gone = await request.get(`/api/programmes?id=${id}`);
    expect(gone.status()).toBe(404);
  }
});

test('create validation: missing name and bad date are 400s', async ({ request }) => {
  const noName = await request.post('/api/programmes', { data: { startDate: '2026-07-01' } });
  expect(noName.status()).toBe(400);
  const badDate = await request.post('/api/programmes', { data: { name: 'X', startDate: 'July' } });
  expect(badDate.status()).toBe(400);
});
