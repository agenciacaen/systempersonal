-- 007_create_webhook_events_and_logs.sql

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  payload jsonb not null,
  processed boolean not null default false,
  error_message text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  processed_at timestamptz
);

create index if not exists idx_webhook_events_user_id on public.webhook_events(user_id);
create index if not exists idx_webhook_events_processed on public.webhook_events(processed);

create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  status text not null,
  detail text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_sync_logs_user_id on public.sync_logs(user_id);
