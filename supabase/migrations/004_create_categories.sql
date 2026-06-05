-- 004_create_categories.sql

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('income', 'expense')),
  color text not null default '#6b7280',
  icon text,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists idx_categories_user_id on public.categories(user_id);
create index if not exists idx_categories_type on public.categories(type);
