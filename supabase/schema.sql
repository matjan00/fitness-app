-- Fitness app database. Run once in Supabase → SQL Editor → New query → Run.
--
-- Everything the app stores (workouts, routines, body weight, later runs, recipes and meals)
-- lives in one table. Each row is one item; "kind" says what it is and "data" holds its fields.
-- The phone keeps its own copy (so the gym works without signal) and syncs this table.

create table if not exists records (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),   -- when it was changed (set by the phone)
  deleted boolean not null default false,
  synced_at timestamptz not null default now()     -- when the server received it (used to fetch changes)
);

create index if not exists records_user_synced on records (user_id, synced_at);
create index if not exists records_user_kind on records (user_id, kind);

create or replace function records_touch() returns trigger language plpgsql as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists records_touch on records;
create trigger records_touch before insert or update on records
  for each row execute function records_touch();

-- Each user only ever sees and changes their own rows.
alter table records enable row level security;
drop policy if exists "own rows" on records;
create policy "own rows" on records for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on records to authenticated;
grant all on records to service_role;
