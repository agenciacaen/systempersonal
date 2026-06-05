-- =====================================================
-- Migration 019: Tags em categories + remover subcategorias
-- =====================================================
-- Mudança de paradigma: subcategorias -> tags
-- - Tags são rótulos livres (text[]) anexados a cada categoria
-- - Todas as categorias são globais (edição livre para todos os usuários)
-- - Remove hierarquia parent_id / subcategory_id

-- 1) Adiciona coluna tags
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_categories_tags ON public.categories USING GIN (tags);

-- 2) Remove infraestrutura de subcategoria
DROP VIEW IF EXISTS public.view_categories_with_subcategories;
DROP VIEW IF EXISTS public.view_category_summary_month;

DROP TRIGGER IF EXISTS trg_check_subcategory ON public.categories;
DROP TRIGGER IF EXISTS trg_check_subcategory ON public.transactions;
DROP FUNCTION IF EXISTS public.check_subcategory_constraints();

ALTER TABLE public.transactions
  DROP COLUMN IF EXISTS subcategory_id;

ALTER TABLE public.categories
  DROP COLUMN IF EXISTS parent_id;

-- 3) Normaliza todas as categorias como globais (user_id = NULL)
--    Assim qualquer usuário pode editar/excluir e todas são visíveis
UPDATE public.categories SET user_id = NULL;
UPDATE public.categories SET is_default = true;

-- 4) Substitui RLS por política global de leitura/escrita
DROP POLICY IF EXISTS "categories_select_own_or_default" ON public.categories;
DROP POLICY IF EXISTS "categories_select_own" ON public.categories;
DROP POLICY IF EXISTS "categories_insert_own" ON public.categories;
DROP POLICY IF EXISTS "categories_update_own" ON public.categories;
DROP POLICY IF EXISTS "categories_delete_own" ON public.categories;
DROP POLICY IF EXISTS "categories_update_own_or_default" ON public.categories;
DROP POLICY IF EXISTS "categories_delete_own_or_default" ON public.categories;
DROP POLICY IF EXISTS "categories_update_public" ON public.categories;
DROP POLICY IF EXISTS "categories_delete_public" ON public.categories;

CREATE POLICY "categories_all_global"
  ON public.categories
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- 5) Recria view_category_summary_month sem lógica de subcategoria
CREATE VIEW public.view_category_summary_month AS
WITH monthly_totals AS (
  SELECT
    t.user_id,
    date_trunc('month', t.transaction_date)::date AS competence_month,
    sum(t.amount) FILTER (WHERE t.type = 'expense') AS total_expense_month
  FROM public.transactions t
  WHERE t.status = 'confirmed'
  GROUP BY t.user_id, date_trunc('month', t.transaction_date)
)
SELECT
  t.user_id,
  date_trunc('month', t.transaction_date)::date AS competence_month,
  c.id AS category_id,
  c.name AS category_name,
  c.color AS category_color,
  c.icon AS category_icon,
  c.tags AS category_tags,
  sum(t.amount) AS total_amount,
  count(t.id) AS transaction_count,
  CASE
    WHEN mt.total_expense_month > 0 AND sum(t.amount) FILTER (WHERE t.type = 'expense') > 0
    THEN round(
      (sum(t.amount) FILTER (WHERE t.type = 'expense') / mt.total_expense_month) * 100, 2)
    ELSE 0
  END AS percentage_of_expense
FROM public.transactions t
LEFT JOIN public.categories c ON c.id = t.category_id
LEFT JOIN monthly_totals mt
  ON mt.user_id = t.user_id
  AND mt.competence_month = date_trunc('month', t.transaction_date)::date
WHERE t.status = 'confirmed'
GROUP BY t.user_id, date_trunc('month', t.transaction_date), c.id, c.name, c.color, c.icon, c.tags, mt.total_expense_month;

-- 6) Atualiza ingest_transaction_from_agent removendo subcategory
CREATE OR REPLACE FUNCTION public.ingest_transaction_from_agent(payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select id into v_category_id from public.categories
    where name = v_category_name limit 1;
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
$function$;
