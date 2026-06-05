-- 006_create_goals_and_budgets.sql

create table if not exists public.monthly_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference_month date not null,
  savings_goal numeric(14,2) not null default 0,
  expense_limit numeric(14,2),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  unique(user_id, reference_month)
);

create index if not exists idx_monthly_goals_user_id on public.monthly_goals(user_id);

create table if not exists public.category_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  reference_month date not null,
  limit_amount numeric(14,2) not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique(user_id, category_id, reference_month)
);

create index if not exists idx_category_budgets_user_id on public.category_budgets(user_id);

create or replace trigger set_monthly_goals_updated_at
  before update on public.monthly_goals
  for each row
  execute function public.update_updated_at_column();
