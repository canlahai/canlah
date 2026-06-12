-- Reports table for CanLah persistence. Run once in the Supabase SQL Editor
-- (prod, and any DEDICATED TEST project used by the CI persistence e2e).
-- The service_role key bypasses RLS, so no policy is needed.

create table if not exists canlah_reports (
  id         text primary key,
  report     jsonb       not null,
  savedAt    text        not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_canlah_reports_saved_at on canlah_reports (savedAt desc);
