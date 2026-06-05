-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.monthly_goals enable row level security;
alter table public.category_budgets enable row level security;
alter table public.webhook_events enable row level security;
alter table public.sync_logs enable row level security;

-- Profiles: user reads/updates only own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Accounts: owner only
create policy "Users can view own accounts"
  on public.accounts for select
  using (auth.uid() = user_id);

create policy "Users can create own accounts"
  on public.accounts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own accounts"
  on public.accounts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own accounts"
  on public.accounts for delete
  using (auth.uid() = user_id);

-- Categories: owner or system default (user_id is null)
create policy "Users can view own and default categories"
  on public.categories for select
  using (auth.uid() = user_id or user_id is null);

create policy "Users can create own categories"
  on public.categories for insert
  with check (auth.uid() = user_id);

create policy "Users can update own categories"
  on public.categories for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own categories"
  on public.categories for delete
  using (auth.uid() = user_id);

-- Transactions: owner only
create policy "Users can view own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

create policy "Users can create own transactions"
  on public.transactions for insert
  with check (auth.uid() = user_id);

create policy "Users can update own transactions"
  on public.transactions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own transactions"
  on public.transactions for delete
  using (auth.uid() = user_id);

-- Monthly goals: owner only
create policy "Users can view own goals"
  on public.monthly_goals for select
  using (auth.uid() = user_id);

create policy "Users can create own goals"
  on public.monthly_goals for insert
  with check (auth.uid() = user_id);

create policy "Users can update own goals"
  on public.monthly_goals for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own goals"
  on public.monthly_goals for delete
  using (auth.uid() = user_id);

-- Category budgets: owner only
create policy "Users can view own budgets"
  on public.category_budgets for select
  using (auth.uid() = user_id);

create policy "Users can create own budgets"
  on public.category_budgets for insert
  with check (auth.uid() = user_id);

create policy "Users can update own budgets"
  on public.category_budgets for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own budgets"
  on public.category_budgets for delete
  using (auth.uid() = user_id);

-- Sync logs: owner only
create policy "Users can view own sync logs"
  on public.sync_logs for select
  using (auth.uid() = user_id);

create policy "Users can create own sync logs"
  on public.sync_logs for insert
  with check (auth.uid() = user_id);

-- Webhook events: service role only (no policies for authenticated users)
create policy "Service role can manage webhook events"
  on public.webhook_events
  for all
  using (auth.role() = 'service_role');
