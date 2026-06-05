-- 016_account_balance_override.sql
-- Permite definir saldo atual editável (override manual) por conta.
-- Quando NULL: saldo = initial_balance + receitas - despesas (cálculo automático).
-- Quando setado: saldo fixo (mostra também o "calculado" para auditoria).

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS current_balance_override numeric,
  ADD COLUMN IF NOT EXISTS balance_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS balance_override_note text;

COMMENT ON COLUMN public.accounts.current_balance_override IS
  'Se definido, sobrescreve o saldo calculado. NULL = cálculo automático (initial + receitas - despesas).';
COMMENT ON COLUMN public.accounts.balance_override_at IS
  'Quando o override foi definido (última vez).';
COMMENT ON COLUMN public.accounts.balance_override_note IS
  'Motivo do ajuste (opcional, ex: "erro de lançamento").';

-- Recria view_account_balances incluindo override + valor calculado + flag has_override.
DROP VIEW IF EXISTS public.view_account_balances;

CREATE VIEW public.view_account_balances AS
SELECT
  a.id AS account_id,
  a.user_id,
  a.name AS account_name,
  a.type AS account_type,
  a.initial_balance,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'  AND t.status = 'confirmed'), 0) AS total_income,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense' AND t.status = 'confirmed'), 0) AS total_expense,
  (a.initial_balance
     + COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'  AND t.status = 'confirmed'), 0)
     - COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense' AND t.status = 'confirmed'), 0)
  ) AS calculated_balance,
  a.current_balance_override,
  a.balance_override_at,
  a.balance_override_note,
  (a.current_balance_override IS NOT NULL) AS has_override,
  COALESCE(
    a.current_balance_override,
    a.initial_balance
      + COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'income'  AND t.status = 'confirmed'), 0)
      - COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'expense' AND t.status = 'confirmed'), 0)
  ) AS current_balance
FROM public.accounts a
LEFT JOIN public.transactions t ON t.account_id = a.id
WHERE a.active = true
GROUP BY a.id, a.user_id, a.name, a.type, a.initial_balance,
         a.current_balance_override, a.balance_override_at, a.balance_override_note;

GRANT SELECT ON public.view_account_balances TO anon, authenticated, service_role;

-- RPC para definir / limpar override
CREATE OR REPLACE FUNCTION public.set_account_balance_override(
  p_account_id uuid,
  p_new_balance numeric,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.accounts
  SET current_balance_override = p_new_balance,
      balance_override_at = now(),
      balance_override_note = p_note,
      updated_at = now()
  WHERE id = p_account_id
    AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_account_balance_override(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.accounts
  SET current_balance_override = NULL,
      balance_override_at = NULL,
      balance_override_note = NULL,
      updated_at = now()
  WHERE id = p_account_id
    AND user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_account_balance_override(uuid, numeric, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_account_balance_override(uuid)
  TO authenticated, service_role;
