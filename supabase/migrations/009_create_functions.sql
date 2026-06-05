-- Function 1: Dashboard summary for a user and month
create or replace function public.get_dashboard_summary(p_user_id uuid, p_reference_month date)
returns table (
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
  prev_net_balance numeric
)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_prev_month date;
begin
  v_prev_month := p_reference_month - interval '1 month';

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
    coalesce(prev.total_income, 0) - coalesce(prev.total_expense, 0)
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

-- Function 2: Monthly trend for charts
create or replace function public.get_monthly_trend(p_user_id uuid, p_months int default 12)
returns table (
  reference_month date,
  total_income numeric,
  total_expense numeric,
  net_balance numeric
)
language plpgsql
security definer set search_path = ''
as $$
begin
  return query
  select
    t.competence_month,
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0) as total_income,
    coalesce(sum(t.amount) filter (where t.type = 'expense'), 0) as total_expense,
    coalesce(sum(t.amount) filter (where t.type = 'income'), 0)
      - coalesce(sum(t.amount) filter (where t.type = 'expense'), 0) as net_balance
  from public.transactions t
  where t.user_id = p_user_id
    and t.status = 'confirmed'
    and t.competence_month >= date_trunc('month', now()) - (p_months - 1) * interval '1 month'
  group by t.competence_month
  order by t.competence_month;
end;
$$;

-- Function 3: Category breakdown for a month
create or replace function public.get_category_breakdown(p_user_id uuid, p_reference_month date)
returns table (
  category_id uuid,
  category_name text,
  category_color text,
  category_icon text,
  total_amount numeric,
  transaction_count bigint,
  percentage_of_expense numeric
)
language plpgsql
security definer set search_path = ''
as $$
declare
  v_total_expense numeric;
begin
  select coalesce(sum(amount), 0) into v_total_expense
  from public.transactions
  where user_id = p_user_id
    and competence_month = p_reference_month
    and type = 'expense'
    and status = 'confirmed';

  return query
  select
    t.category_id,
    coalesce(c.name, 'Sem categoria') as category_name,
    coalesce(c.color, '#6b7280') as category_color,
    c.icon as category_icon,
    sum(t.amount) as total_amount,
    count(*) as transaction_count,
    case
      when v_total_expense > 0
      then round((sum(t.amount) / v_total_expense) * 100, 2)
      else 0
    end as percentage_of_expense
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.user_id = p_user_id
    and t.competence_month = p_reference_month
    and t.type = 'expense'
    and t.status = 'confirmed'
  group by t.category_id, c.name, c.color, c.icon
  order by total_amount desc;
end;
$$;

-- Function 4: Ingest transaction from external agent (Evolution API webhook)
create or replace function public.ingest_transaction_from_agent(payload jsonb)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_webhook_id uuid;
  v_user_id uuid;
  v_account_id uuid;
  v_category_id uuid;
  v_type text;
  v_amount numeric;
  v_description text;
  v_transaction_date date;
  v_competence_month date;
  v_source text;
  v_external_message_id text;
  v_status text;
  v_confidence_score numeric;
  v_transaction_id uuid;
begin
  -- Extract fields from payload
  v_user_id := (payload->>'user_id')::uuid;
  v_type := payload->>'type';
  v_amount := (payload->>'amount')::numeric;
  v_description := coalesce(payload->>'description', 'Transação automática');
  v_transaction_date := coalesce((payload->>'transaction_date')::date, current_date);
  v_competence_month := date_trunc('month', v_transaction_date)::date;
  v_source := coalesce(payload->>'source', 'webhook');
  v_external_message_id := payload->>'external_message_id';
  v_status := coalesce(payload->>'status', 'pending_review');
  v_confidence_score := (payload->>'confidence_score')::numeric;

  -- Look up or use provided account_id
  v_account_id := (payload->>'account_id')::uuid;
  if v_account_id is null then
    select id into v_account_id
    from public.accounts
    where user_id = v_user_id and active = true
    order by created_at
    limit 1;
  end if;

  -- Look up category by name if provided, otherwise use provided category_id
  v_category_id := (payload->>'category_id')::uuid;
  if v_category_id is null and payload->>'category_name' is not null then
    select id into v_category_id
    from public.categories
    where user_id = v_user_id and name = payload->>'category_name';
    if v_category_id is null then
      select id into v_category_id
      from public.categories
      where user_id is null and is_default = true and name = payload->>'category_name';
    end if;
  end if;

  -- Register webhook event for audit trail
  insert into public.webhook_events (provider, user_id, event_type, payload, processed)
  values (coalesce(payload->>'provider', 'evolution_api'), v_user_id, 'transaction_ingest', payload, true)
  returning id into v_webhook_id;

  -- Idempotency: skip if external_message_id already processed
  if v_external_message_id is not null then
    if exists (select 1 from public.transactions where external_message_id = v_external_message_id and user_id = v_user_id) then
      select id into v_transaction_id
      from public.transactions
      where external_message_id = v_external_message_id and user_id = v_user_id;
      return v_transaction_id;
    end if;
  end if;

  -- Insert transaction
  insert into public.transactions (
    user_id, account_id, category_id, type, amount,
    description, transaction_date, competence_month,
    source, external_message_id, status,
    confidence_score, raw_input
  ) values (
    v_user_id, v_account_id, v_category_id, v_type, v_amount,
    v_description, v_transaction_date, v_competence_month,
    v_source, v_external_message_id, v_status,
    v_confidence_score, payload::text
  ) returning id into v_transaction_id;

  return v_transaction_id;
end;
$$;
