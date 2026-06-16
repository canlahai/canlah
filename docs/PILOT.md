# Programme Planner — one-team pilot runbook

Goal: get **one main contractor + a couple of their subcontractors** live on a single
programme, then watch whether they actually update it. We are validating demand for
collaborative planning, not adding features. Do not build new depth until a real team
hits a wall.

## Why this matters
Collaboration features only create value when more than one real party is on the same
schedule. "Subcon updates their checklist" cannot be validated without a subcon. This
pilot is the validation.

---

## Prod prerequisites (do these once, before anyone logs in)

These are **blocking**. Skipping them means silent data loss or a meaningless test.

1. **Run the SQL** in the prod Supabase project (SQL Editor):
   - `db/programmes.sql`
   - `db/programme-invites.sql` (includes the membership `access_level` / `trade_role` ALTERs)
   - `db/users.sql`
   Without these, programmes/invites fall back to a local JSON file. On Vercel that
   filesystem is ephemeral — writes vanish when the function spins down. **Tables are
   mandatory in prod, not optional.**

2. **Confirm env** in the Vercel project: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
   `BLOB_READ_WRITE_TOKEN`, `ANTHROPIC_API_KEY`, `SESSION_SECRET`.

3. **Turn on per-user accounts:** set `AUTH_MODE=users`. Invites, Admin/Editor/Viewer,
   and "who updated what" are meaningless in the default shared-password mode.

4. **Seed the main con's admin account:**
   `npm run seed:admin -- <email> <password> "<Name>"` (run against prod Supabase).

5. **Make the main con Pro** (Programme Planner is Pro-gated):
   `PATCH /api/users { id, tier: "pro" }` as an admin, or set their tier in the DB.

---

## Onboarding the team

### Main contractor (admin)
1. Logs in at `/login`.
2. Goes to `/programme`, creates a programme (name + start date).
3. Adds activities (trade / section / duration / dependencies). BQ→programme
   auto-population is not wired yet — manual for the pilot.

### Each subcontractor
The model is **admin-creates-accounts** (open signup is off):
1. **You (or the main con admin)** create the subcon's account under their email:
   `npm run seed:admin -- <subcon-email> <temp-password> "<Name>"` (role `user`),
   or via the admin `POST /api/users`.
2. Main con opens **Team & access** on the programme → **Invite by email**
   (email + access level + trade role) → **Create invite** → copies the link.
3. Send the link to the subcon (WhatsApp / email — your choice).
4. Subcon opens the link, signs in with their account, clicks **Accept & join**.
   (Acceptance is email-matched — the link can't be claimed by anyone else.)

Access levels: **Admin** (manage team + edit), **Editor** (update activities),
**Viewer** (read-only). Trade role (PM / Engineer / Procurement / Subcon / Supervisor)
is a label, not a permission.

---

## What to watch (the actual experiment)

Open the programme's **Activity log** and the **At-risk** tile daily.

**Success signals (collaboration is the wedge):**
- A subcon logs in *unprompted* and updates a status, checklist item, or delivery.
- A real delay gets attributed to a party ("concrete delayed — Procurement").
- The main con checks the activity feed instead of calling/WhatsApping for status.

**Kill / pivot signals (it's not the wedge yet):**
- After a week, only the main con touches it. Subs don't log in.
- People update it once, then go back to WhatsApp.
- The manual activity entry is too heavy to be worth it (→ that's the signal to wire
  BQ→programme auto-population, the real moat).

Write down what you see. Their behaviour drives the next feature, not our guesses.

---

## Rollback
Everything is Pro-gated and on its own branch. If the pilot flops: don't merge further,
or revert the `feat/collaborative-planning` merge. No data migration to undo (the tables
just sit unused).
