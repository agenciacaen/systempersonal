-- Migration 031: Adiciona total_account_balance no get_dashboard_summary
-- Mostra o saldo total consolidado de todas as contas (incluindo override)

DROP FUNCTION IF EXISTS public.get_dashboard_summary(uuid, date);

CREATE OR REPLACE FUNCTION public.get_dashboard_summary(
  p_user_id uuid,
  p_reference_month date
)
RETURNS TABLE (
  total_income numeric,
  total_expense numeric,
  net_balance numeric,
  savings_value numeric,
  total_transactions bigint,
  goal_savings_goal numeric,
  goal_expense_limit numeric,
  goal_progress_pct numeric,
  prev_total_income numeric,
  prev_total_expense numeric,
  prev_net_balance numeric,
  total_account_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_prev_month date;
  v_total_balance numeric;
begin
  v_prev_month := p_reference_month - interval '1 month';

  -- Soma do saldo de todas as contas (current_balance já considera override + calculated)
  SELECT COALESCE(SUM(v.current_balance), 0)
    INTO v_total_balance
    FROM public.view_account_balances v
   WHERE v.user_id = p_user_id;

  return query
  select
    coalesce(cur.total_income, 0),
    coalesce(cur.total_expense, 0),
    coalesce(cur.total_income, 0) - coalesce(cur.total_expense, 0),
    case
      when coalesce(cur.total_income, 0) > coalesce(cur.total_expense, 0)
      then coalesce(cur.total_income, 0) - coalesce(cur.total_expense, 0)
      else 0
    end,
    coalesce(cur.total_transactions, 0),
    coalesce(mg.savings_goal, 0),
    mg.expense_limit,
    case
      when coalesce(mg.savings_goal, 0) > 0
      then round(
        (case
          when coalesce(cur.total_income, 0) > coalesce(cur.total_expense, 0)
          then (coalesce(cur.total_income, 0) - coalesce(cur.total_expense, 0)) / mg.savings_goal * 100
          else 0
        end)::numeric, 2)
      else 0
    end,
    coalesce(prev.total_income, 0),
    coalesce(prev.total_expense, 0),
    coalesce(prev.total_income, 0) - coalesce(prev.total_expense, 0),
    v_total_balance
  from (select
      coalesce(sum(amount) filter (where type = 'income'), 0) as total_income,
      coalesce(sum(amount) filter (where type = 'expense'), 0) as total_expense,
      count(*) as total_transactions
    from public.transactions
    where user_id = p_user_id
      and competence_month = p_reference_month
      and status = 'confirmed'
  ) cur
  cross join (select
      coalesce(sum(amount) filter (where type = 'income'), 0) as total_income,
      coalesce(sum(amount) filter (where type = 'expense'), 0) as total_expense
    from public.transactions
    where user_id = p_user_id
      and competence_month = v_prev_month
      and status = 'confirmed'
  ) prev
  left join public.monthly_goals mg
    on mg.user_id = p_user_id
    and mg.reference_month = p_reference_month;
end;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(uuid, date) TO anon, authenticated;
