-- 005_create_transactions.sql

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete restrict,
  category_id uuid references public.categories(id) on delete set null,
  type text not null check (type in ('income', 'expense')),
  amount numeric(14,2) not null check (amount > 0),
  description text not null,
  notes text,
  transaction_date date not null,
  competence_month date not null,
  source text not null check (source in ('manual', 'whatsapp', 'webhook', 'import')),
  external_message_id text,
  status text not null default 'confirmed' check (status in ('confirmed', 'pending_review', 'ignored')),
  confidence_score numeric(5,2),
  raw_input text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists idx_transactions_external_message_id
  on public.transactions(external_message_id)
  where external_message_id is not null;

create index if not exists idx_transactions_user_id on public.transactions(user_id);
create index if not exists idx_transactions_transaction_date on public.transactions(transaction_date);
create index if not exists idx_transactions_competence_month on public.transactions(competence_month);
create index if not exists idx_transactions_category_id on public.transactions(category_id);
create index if not exists idx_transactions_status on public.transactions(status);
create index if not exists idx_transactions_user_month on public.transactions(user_id, competence_month);

create or replace trigger set_transactions_updated_at
  before update on public.transactions
  for each row
  execute function public.update_updated_at_column();
