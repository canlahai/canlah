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
  expect(programme.access).toBe('admin');
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

test('collaborative activity update: status + checklist + parties + attributed log', async ({ request }) => {
  const created = await request.post('/api/programmes', {
    data: { name: 'Collab Test', startDate: '2026-07-01',
      activities: [{ id: 'a1', name: 'Cast slab', durationDays: 3, predecessors: [] }] },
  });
  const id = (await created.json()).programme.id;
  try {
    const upd = await request.patch('/api/programmes', {
      data: { id, activityId: 'a1', note: 'Concrete delayed — supplier issue',
        patch: {
          status: 'blocked', responsibleParty: 'Procurement', blockedReason: 'concrete delivery delayed',
          parties: [{ role: 'procurement', who: 'Raj', responsibility: 'concrete delivery' }],
          checklist: [
            { id: 'c1', item: 'Formwork inspection', status: 'complied' },
            { id: 'c2', item: 'Rebar inspection', status: 'not_complied' },
          ],
          deliveries: [{ id: 'd1', item: 'Ready-mix G40', neededBy: '2026-07-02', responsible: 'Procurement', status: 'delayed' }],
        } },
    });
    expect(upd.status()).toBe(200);
    const activity = (await upd.json()).activity;
    expect(activity.status).toBe('blocked');
    expect(activity.updates.length).toBe(1);
    expect(activity.updates[0].note).toMatch(/supplier/);

    // Persisted + a second contributor appends rather than overwrites.
    await request.patch('/api/programmes', { data: { id, activityId: 'a1', patch: { status: 'in_progress' }, note: 'Supplier confirmed Friday' } });
    const one = await (await request.get(`/api/programmes?id=${id}`)).json();
    const a1 = one.programme.activities.find((a) => a.id === 'a1');
    expect(a1.status).toBe('in_progress');
    expect(a1.checklist.length).toBe(2);
    expect(a1.parties[0].who).toBe('Raj');
    expect(a1.deliveries[0].status).toBe('delayed');
    expect(a1.updates.length).toBe(2);

    // Unknown activity → 400.
    const bad = await request.patch('/api/programmes', { data: { id, activityId: 'ghost', patch: { status: 'done' } } });
    expect(bad.status()).toBe(400);
  } finally {
    await request.delete('/api/programmes', { data: { id } });
  }
});

test('invites: create → list → get-by-token → email-mismatch accept blocked → revoke', async ({ request }) => {
  const created = await request.post('/api/programmes', { data: { name: 'Invite Test', startDate: '2026-07-01', activities: [] } });
  const id = (await created.json()).programme.id;
  try {
    // Admin (owner, in demo) creates an invite.
    const made = await request.post('/api/invites', { data: { programmeId: id, email: 'Subcon@Acme.SG', accessLevel: 'editor', tradeRole: 'subcon' } });
    expect(made.status()).toBe(200);
    const invite = (await made.json()).invite;
    expect(invite.email).toBe('subcon@acme.sg');
    expect(invite.accessLevel).toBe('editor');
    const token = invite.token;

    // Listed as pending.
    const list = await (await request.get(`/api/invites?programmeId=${id}`)).json();
    expect(list.invites.some((i) => i.token === token)).toBe(true);

    // Lookup by token (accept page).
    const byTok = await (await request.get(`/api/invites?token=${token}`)).json();
    expect(byTok.invite.programmeName).toBe('Invite Test');

    // Accept requires the signed-in email to match the invite — demo user can't.
    const acc = await request.post('/api/invites', { data: { action: 'accept', token } });
    expect(acc.status()).toBe(403);

    // Bad inputs.
    expect((await request.post('/api/invites', { data: { programmeId: id, email: 'nope', accessLevel: 'editor' } })).status()).toBe(400);
    expect((await request.post('/api/invites', { data: { programmeId: id, email: 'x@y.co', accessLevel: 'king' } })).status()).toBe(400);

    // Revoke → no longer pending.
    expect((await request.delete('/api/invites', { data: { token } })).status()).toBe(200);
    const after = await (await request.get(`/api/invites?programmeId=${id}`)).json();
    expect(after.invites.some((i) => i.token === token)).toBe(false);
  } finally {
    await request.delete('/api/programmes', { data: { id } });
  }
});
