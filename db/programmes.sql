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
  end_date    text,                          -- 'YYYY-MM-DD' optional target/contract end
  activities  jsonb not null default '[]',   -- [{id,name,trade,section,durationDays,predecessors,assignee,status}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_canlah_programmes_owner on canlah_programmes (owner_id);
-- Existing deployments: add the target end-date column if upgrading.
alter table canlah_programmes add column if not exists end_date text;
-- Saved baseline snapshot (Baseline tab S-curve + variance).
alter table canlah_programmes add column if not exists baseline jsonb;

create table if not exists canlah_programme_members (
  programme_id text not null references canlah_programmes (id) on delete cascade,
  user_id      text not null,                -- canlah_users.id
  role         text not null default 'viewer'
                 check (role in ('pm', 'engineer', 'procurement', 'subcon', 'viewer')),
  added_at     timestamptz not null default now(),
  primary key (programme_id, user_id)
);

create index if not exists idx_canlah_pm_members_user on canlah_programme_members (user_id);
