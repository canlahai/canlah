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
