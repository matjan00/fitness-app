-- Sync guard: an older edit can no longer overwrite a newer one.
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
--
-- Problem it fixes: the phone edits a recipe offline at 10:00, the laptop edits the same recipe at 11:00 and syncs,
-- then the phone comes online and uploads its 10:00 version, which used to replace the 11:00 one everywhere.
-- Now the server keeps whichever version has the later updated_at (the time of the edit, set by the device). When it
-- keeps its own copy it still bumps synced_at, so the device that sent the old version downloads the newer one on
-- the same sync (the app uploads first, then downloads changes since its last download).

create or replace function records_touch() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    new.kind := old.kind;
    new.data := old.data;
    new.updated_at := old.updated_at;
    new.deleted := old.deleted;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists records_touch on records;
create trigger records_touch before insert or update on records
  for each row execute function records_touch();
