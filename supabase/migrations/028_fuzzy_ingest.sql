-- Update ingest_transaction_from_agent to use fuzzy category lookup
CREATE OR REPLACE FUNCTION public.ingest_transaction_from_agent(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  v_category_name text;
begin
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
  v_category_name := payload->>'category_name';

  v_account_id := (payload->>'account_id')::uuid;
  if v_account_id is null then
    select id into v_account_id from public.accounts
    where user_id = v_user_id and active = true order by created_at limit 1;
  end if;

  v_category_id := (payload->>'category_id')::uuid;
  if v_category_id is null and v_category_name is not null then
    v_category_id := public.resolve_category_id(v_category_name);
  end if;

  insert into public.webhook_events (provider, user_id, event_type, payload, processed)
  values (coalesce(payload->>'provider', 'evolution_api'), v_user_id, 'transaction_ingest', payload, true)
  returning id into v_webhook_id;

  if v_external_message_id is not null then
    if exists (select 1 from public.transactions where external_message_id = v_external_message_id and user_id = v_user_id) then
      select id into v_transaction_id from public.transactions
      where external_message_id = v_external_message_id and user_id = v_user_id;
      return v_transaction_id;
    end if;
  end if;

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
