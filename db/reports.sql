-- Reports table for CanLah persistence. Run once in the Supabase SQL Editor
-- (prod, and any DEDICATED TEST project used by the CI persistence e2e).
-- The service_role key bypasses RLS, so no policy is needed.

-- NOTE: "savedAt" is QUOTED to preserve the mixed case. The app (lib/reports.js)
-- inserts/orders by `savedAt` via PostgREST, which is case-sensitive — an unquoted
-- column folds to lowercase `savedat` and breaks every query. Prod uses "savedAt".
create table if not exists canlah_reports (
  id         text primary key,
  report     jsonb       not null,
  "savedAt"  text        not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_canlah_reports_saved_at on canlah_reports ("savedAt" desc);
