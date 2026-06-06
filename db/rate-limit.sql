-- Durable rate limiting for CanLah (opt-in via RATE_LIMIT_DURABLE=true).
-- Run once in the Supabase SQL Editor. Until then, the app uses the in-memory
-- limiter and this is unused.
--
-- Backs lib/rate-limit.js → checkDurable() → supabase.rpc('check_rate_limit', ...).

create table if not exists canlah_rate_limit_hits (
  id  bigint generated always as identity primary key,
  key text        not null,           -- "<route-id>:<client-ip>"
  ts  timestamptz not null default now()
);

create index if not exists idx_rlh_key_ts
  on canlah_rate_limit_hits (key, ts desc);

-- Atomic, cross-instance sliding-window check. Prunes expired hits for the key,
-- records this hit, and reports whether the count is within the limit.
create or replace function check_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
) returns boolean
language plpgsql
as $$
declare
  cnt int;
begin
  delete from canlah_rate_limit_hits
    where key = p_key
      and ts < now() - make_interval(secs => p_window_seconds);

  insert into canlah_rate_limit_hits (key) values (p_key);

  select count(*) into cnt
    from canlah_rate_limit_hits
    where key = p_key
      and ts >= now() - make_interval(secs => p_window_seconds);

  return cnt <= p_limit;
end;
$$;

-- The service_role key (used server-side) bypasses RLS, so no policy is needed.
-- Optional housekeeping: schedule a periodic prune of very old rows, e.g. via
-- pg_cron:  delete from canlah_rate_limit_hits where ts < now() - interval '1 day';
