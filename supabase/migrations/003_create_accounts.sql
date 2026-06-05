-- 003_create_accounts.sql

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('cash', 'checking', 'savings', 'credit_card', 'investment')),
  initial_balance numeric(14,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_accounts_user_id on public.accounts(user_id);

create or replace trigger set_accounts_updated_at
  before update on public.accounts
  for each row
  execute function public.update_updated_at_column();
