-- CanLah prod setup — Programme Planner + users-mode + invites.
-- Paste this whole file into the Supabase SQL Editor and Run. Idempotent (safe to re-run).

-- ===== db/users.sql =====
-- Per-user accounts for CanLah (AUTH_MODE=users). Run once in the Supabase SQL
-- Editor. Backs lib/users.js. The service_role key bypasses RLS, so no policy
-- is needed. Open signup is not exposed — accounts are admin-created.

create table if not exists canlah_users (
  id              text primary key,
  email           text not null unique,
  password_hash   text not null,            -- scrypt$salt$hash (never the plaintext)
  name            text,
  role            text not null default 'user' check (role in ('user', 'admin')),
  disabled        boolean not null default false,
  tier            text not null default 'free' check (tier in ('free', 'pro')),
  reads_this_month int not null default 0,  -- free-tier monthly read counter
  reads_period    text,                     -- 'YYYY-MM' the counter belongs to
  created_at      timestamptz not null default now()
);

create index if not exists idx_canlah_users_email on canlah_users (email);

-- Existing deployments: add the tier/reads columns if upgrading.
alter table canlah_users add column if not exists tier text not null default 'free';
alter table canlah_users add column if not exists reads_this_month int not null default 0;
alter table canlah_users add column if not exists reads_period text;

-- Seed the first admin with: node scripts/seed-admin.mjs <email> <password> [name]
-- (run against this Supabase project), then set AUTH_MODE=users.

-- ===== db/programmes.sql =====
-- Programme Planner (Pro) — collaborative construction schedules.
-- Run once in the Supabase SQL Editor. Backs lib/programmes.js. The service_role
-- key bypasses RLS, so application code enforces membership/roles (no RLS policy).
--
-- MVP storage model: the activity tree lives as a JSONB document on the programme
-- row (last-write-wins on save). Membership + per-user role live in a join table.

create table if not exists canlah_programmes (
  id          text primary key,
  name        text not null,
  owner_id    text not null,                 -- canlah_users.id of the creator
  start_date  text not null,                 -- 'YYYY-MM-DD' project start
  activities  jsonb not null default '[]',   -- [{id,name,trade,section,durationDays,predecessors,assignee,status}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_canlah_programmes_owner on canlah_programmes (owner_id);

create table if not exists canlah_programme_members (
  programme_id text not null references canlah_programmes (id) on delete cascade,
  user_id      text not null,                -- canlah_users.id
  role         text not null default 'viewer'
                 check (role in ('pm', 'engineer', 'procurement', 'subcon', 'viewer')),
  added_at     timestamptz not null default now(),
  primary key (programme_id, user_id)
);

create index if not exists idx_canlah_pm_members_user on canlah_programme_members (user_id);

-- ===== db/programme-invites.sql =====
-- Programme invites (Pro). Run once in the Supabase SQL Editor. Backs lib/invites.js.
-- The main con (programme admin) invites by email + access level; a shareable link
-- carries the token. The invitee (account created by an admin under that email)
-- signs in and accepts → membership granted. service_role bypasses RLS.

create table if not exists canlah_programme_invites (
  token          text primary key,
  programme_id   text not null references canlah_programmes (id) on delete cascade,
  programme_name text,
  email          text not null,
  access_level   text not null default 'viewer'
                   check (access_level in ('admin', 'editor', 'viewer')),
  trade_role     text check (trade_role in ('pm', 'engineer', 'procurement', 'subcon', 'supervisor')),
  status         text not null default 'pending'
                   check (status in ('pending', 'accepted', 'revoked')),
  invited_by     text,
  accepted_by    text,
  accepted_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_canlah_invites_programme on canlah_programme_invites (programme_id);
create index if not exists idx_canlah_invites_email on canlah_programme_invites (email);

-- Access levels also live on memberships now — add the columns if upgrading from
-- the earlier (single trade-role) membership model.
alter table canlah_programme_members add column if not exists access_level text not null default 'viewer';
alter table canlah_programme_members add column if not exists trade_role text;
