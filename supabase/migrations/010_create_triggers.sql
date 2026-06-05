-- Trigger: auto-fill competence_month from transaction_date
create or replace function public.set_competence_month()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  new.competence_month := date_trunc('month', new.transaction_date)::date;
  return new;
end;
$$;

create or replace trigger set_transactions_competence_month
  before insert or update of transaction_date on public.transactions
  for each row
  execute function public.set_competence_month();

-- Trigger: notify realtime channel on transaction insert
create or replace function public.notify_transaction_inserted()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  perform pg_notify(
    'transaction_inserted',
    json_build_object(
      'id', new.id,
      'user_id', new.user_id,
      'type', new.type,
      'amount', new.amount,
      'description', new.description,
      'competence_month', new.competence_month,
      'status', new.status
    )::text
  );
  return new;
end;
$$;

create or replace trigger on_transaction_inserted
  after insert on public.transactions
  for each row
  execute function public.notify_transaction_inserted();
