# TODOS

Deferred work, captured so it isn't lost. Ordered roughly by leverage. Do NOT build the
collaboration-depth items until the one-team pilot (see `docs/PILOT.md`) shows real
multi-party usage. Demand first, depth second.

## Blocking the pilot (do before onboarding a real team)
- [ ] **Run prod SQL**: `db/programmes.sql`, `db/programme-invites.sql`, `db/users.sql`.
      Without these, prod writes go to an ephemeral local file and vanish. (P1)
- [ ] **Set `AUTH_MODE=users`** in prod + seed the main-con admin; make them tier `pro`. (P1)
- [ ] **Split is done** — collaboration lives on `feat/collaborative-planning` (off main);
      tree work parked on `fix/tree-felling-colour-status`. Merge collab via PR once
      prod prereqs are set.

## The real moat (highest leverage, but validate first)
- [ ] **BQ → programme auto-population.** Wire the AI doc readers (BQ / tree-felling)
      to draft a programme's activities + quantities automatically. This is the thing
      Procore/monday can't do — "upload your drawings, get a starting schedule." The
      collaboration layer is the room; this is the pipe that fills it. (P1 once pilot
      validates collaboration demand.)

## Core wedge — parked, needs the user
- [ ] **Verify tree-felling per-sheet accuracy** on a real 17-sheet drawing
      (`fix/tree-felling-colour-status`). Numbers were wrong; per-sheet read + tally
      self-check is built but unverified. Blocked on a real PDF. Until this is proven,
      the doc-reading product has an open accuracy question. (P1)

## Collaboration depth (deferred — build only on real-user demand)
- [ ] **Real auto-email invites.** Currently shareable links only. Wire an email
      provider (Resend/SES) + verified sender so invites send themselves. (P2)
- [ ] **Inline member access edits.** Today an admin removes + re-invites to change a
      member's access level. Add an inline edit (change Editor↔Viewer in place). (P3)
- [ ] **Notifications.** "You were assigned", "a delivery you own is overdue",
      "an activity you're a party on got blocked." Push/email. (P2, demand-driven)
- [ ] **Per-project checklist libraries.** Save a team's edited checklist templates so
      they reuse their own ITP, not just the built-in starters. (P3)
- [ ] **Checklist sign-off by role.** Restrict who can mark an inspection "complied"
      (e.g. only the engineer/RE), with a signed-off-by name + timestamp. (P2)
- [ ] **Self-onboard via invite (optional).** If admin-creates-accounts proves too
      heavy, allow invite links to create the account in one step (token-gated signup),
      while keeping general open signup off. (P3)

## Hygiene
- [ ] Consider an integration/e2e test that runs against a real (test) Supabase project
      so the collaborative flows are verified against Postgres, not just local JSON.
- [ ] gstack itself has a major update available (1.12 → 1.58); upgrade when convenient.
