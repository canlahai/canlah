-- Subcontractor / contact directory (Pro). Run once in the Supabase SQL Editor.
-- Backs lib/contacts.js — an owner's reusable address book of subs/consultants,
-- so they can be invited onto any programme in one click. service_role bypasses RLS.

create table if not exists canlah_contacts (
  id          text primary key,
  owner_id    text not null,
  email       text not null,
  name        text,
  company     text,
  trade_role  text check (trade_role in ('pm', 'engineer', 'procurement', 'subcon', 'supervisor')),
  created_at  timestamptz not null default now(),
  unique (owner_id, email)
);

create index if not exists idx_canlah_contacts_owner on canlah_contacts (owner_id);
