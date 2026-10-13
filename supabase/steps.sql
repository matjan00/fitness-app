-- Raw phone step intervals from the steps-webhook edge function (HC Webhook app → Health Connect).
-- Only the edge function (service role) reads and writes this table; the app itself never sees it,
-- it only gets the daily totals written into the cut plan's 'daily' records.

create table if not exists step_samples (
  user_id uuid not null references auth.users(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  count integer not null,
  received_at timestamptz not null default now(),
  primary key (user_id, start_time, end_time)
);

-- RLS on with no policies: logged-in users get nothing, the service role bypasses it.
alter table step_samples enable row level security;
grant all on step_samples to service_role;
