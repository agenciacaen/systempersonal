-- 033: remover auto-clear de current_balance_override
-- Usuário quer saldo único, sem override/calculado.
-- Quando ele define o saldo, ele QUER aquele valor fixo.

DROP TRIGGER IF EXISTS trg_clear_account_balance_override_insert ON public.transactions;
DROP TRIGGER IF EXISTS trg_clear_account_balance_override_update ON public.transactions;
DROP TRIGGER IF EXISTS trg_clear_account_balance_override_delete ON public.transactions;
DROP FUNCTION IF EXISTS public.clear_account_balance_override();
