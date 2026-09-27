-- Strava connection (run once in Supabase → SQL Editor → New query → Run, after schema.sql).
--
-- Holds each user's Strava tokens. Only the "strava" Edge Function (service role) reads or writes it:
-- row level security is ON and there are deliberately NO policies, so the app itself (anon /
-- authenticated keys) can never see the tokens.

create table if not exists strava_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_id bigint not null unique,
  athlete_name text,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  last_sync_at timestamptz,
  full_sync_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table strava_tokens enable row level security;
revoke all on strava_tokens from anon, authenticated;
grant all on strava_tokens to service_role;
