-- 008_create_views.sql

create or replace view public.view_monthly_summary as
select
  t.user_id,
  t.competence_month,
  coalesce(sum(t.amount) filter (where t.type = 'income' and t.status = 'confirmed'), 0) as total_income,
  coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'confirmed'), 0) as total_expense,
  coalesce(sum(t.amount) filter (where t.type = 'income' and t.status = 'confirmed'), 0)
    - coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'confirmed'), 0) as net_balance,
  case
    when coalesce(sum(t.amount) filter (where t.type = 'income' and t.status = 'confirmed'), 0)
      > coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'confirmed'), 0)
    then coalesce(sum(t.amount) filter (where t.type = 'income' and t.status = 'confirmed'), 0)
      - coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'confirmed'), 0)
    else 0
  end as savings_value,
  count(*) filter (where t.status = 'confirmed') as total_transactions
from public.transactions t
group by t.user_id, t.competence_month;

create or replace view public.view_category_summary_month as
with monthly_expense as (
  select
    t.user_id,
    t.competence_month,
    sum(t.amount)::numeric as total_expense_month
  from public.transactions t
  where t.type = 'expense' and t.status = 'confirmed'
  group by t.user_id, t.competence_month
)
select
  t.user_id,
  t.competence_month,
  t.category_id,
  c.name as category_name,
  c.color as category_color,
  c.icon as category_icon,
  sum(t.amount) as total_amount,
  count(*) as transaction_count,
  case
    when me.total_expense_month > 0
    then round((sum(t.amount) / me.total_expense_month) * 100, 2)
    else 0
  end as percentage_of_expense
from public.transactions t
left join public.categories c on c.id = t.category_id
left join monthly_expense me on me.user_id = t.user_id and me.competence_month = t.competence_month
where t.type = 'expense' and t.status = 'confirmed'
group by t.user_id, t.competence_month, t.category_id, c.name, c.color, c.icon, me.total_expense_month;

create or replace view public.view_account_balances as
select
  a.id as account_id,
  a.user_id,
  a.name as account_name,
  a.type as account_type,
  a.initial_balance,
  coalesce(sum(t.amount) filter (where t.type = 'income' and t.status = 'confirmed'), 0) as total_income,
  coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'confirmed'), 0) as total_expense,
  a.initial_balance
    + coalesce(sum(t.amount) filter (where t.type = 'income' and t.status = 'confirmed'), 0)
    - coalesce(sum(t.amount) filter (where t.type = 'expense' and t.status = 'confirmed'), 0) as current_balance
from public.accounts a
left join public.transactions t on t.account_id = a.id
where a.active = true
group by a.id, a.user_id, a.name, a.type, a.initial_balance;
