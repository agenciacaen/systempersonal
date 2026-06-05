-- Migration 015: Account breakdown RPC + transactions by account RPC + summary view

-- Function: Receitas e despesas agrupadas por conta
create or replace function public.get_account_breakdown(
  p_user_id uuid,
  p_reference_month date default date_trunc('month', now())
)
returns table (
  account_id uuid,
  account_name text,
  account_type text,
  account_icon text,
  total_income numeric,
  total_expense numeric,
  transaction_count bigint
)
language plpgsql
security definer set search_path = ''
as $func$
begin
  return query
  select
    a.id as account_id,
    a.name as account_name,
    a.type as account_type,
    case a.type
      when 'cash' then 'banknote'
      when 'checking' then 'wallet'
      when 'savings' then 'piggy-bank'
      when 'credit_card' then 'credit-card'
      when 'investment' then 'trending-up'
      else 'wallet'
    end as account_icon,
    coalesce(sum(t.amount) filter (where t.type = 'income' and t.status = 'confirmed'), 0) as total_income,
    coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'confirmed'), 0) as total_expense,
    count(t.id) as transaction_count
  from public.accounts a
  left join public.transactions t
    on t.account_id = a.id
    and t.user_id = a.user_id
    and t.competence_month = p_reference_month
  where a.user_id = p_user_id
    and a.active = true
  group by a.id, a.name, a.type
  order by (coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'confirmed'), 0)) desc;
end;
$func$;

-- Function: Lista transações filtradas por conta + período
create or replace function public.get_transactions_by_account(
  p_user_id uuid,
  p_account_id uuid,
  p_start_date date default null,
  p_end_date date default null,
  p_type text default 'all'
)
returns table (
  id uuid,
  type text,
  amount numeric,
  description text,
  transaction_date date,
  status text,
  category_name text,
  category_color text,
  category_icon text
)
language plpgsql
security definer set search_path = ''
as $func$
begin
  return query
  select
    t.id, t.type, t.amount, t.description, t.transaction_date, t.status,
    c.name as category_name, c.color as category_color, c.icon as category_icon
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.user_id = p_user_id
    and t.account_id = p_account_id
    and (p_start_date is null or t.transaction_date >= p_start_date)
    and (p_end_date is null or t.transaction_date <= p_end_date)
    and (p_type = 'all' or t.type = p_type)
  order by t.transaction_date desc, t.created_at desc
  limit 200;
end;
$func$;

-- View: Resumo de transações por conta
create or replace view public.view_account_transactions_summary as
select
  a.id as account_id,
  a.user_id,
  a.name as account_name,
  a.type as account_type,
  count(t.id) filter (where t.status = 'confirmed') as confirmed_count,
  count(t.id) filter (where t.status = 'pending_review') as pending_count,
  coalesce(sum(t.amount) filter (where t.type = 'income' and t.status = 'confirmed'), 0) as total_income,
  coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'confirmed'), 0) as total_expense,
  max(t.transaction_date) as last_transaction_date
from public.accounts a
left join public.transactions t on t.account_id = a.id
where a.active = true
group by a.id, a.user_id, a.name, a.type;

grant execute on function public.get_account_breakdown to authenticated;
grant execute on function public.get_transactions_by_account to authenticated;
grant select on public.view_account_transactions_summary to authenticated;
