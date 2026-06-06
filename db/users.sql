-- Per-user accounts for CanLah (AUTH_MODE=users). Run once in the Supabase SQL
-- Editor. Backs lib/users.js. The service_role key bypasses RLS, so no policy
-- is needed. Open signup is not exposed — accounts are admin-created.

create table if not exists canlah_users (
  id            text primary key,
  email         text not null unique,
  password_hash text not null,            -- scrypt$salt$hash (never the plaintext)
  name          text,
  role          text not null default 'user' check (role in ('user', 'admin')),
  disabled      boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists idx_canlah_users_email on canlah_users (email);

-- Seed the first admin with: node scripts/seed-admin.mjs <email> <password> [name]
-- (run against this Supabase project), then set AUTH_MODE=users.
