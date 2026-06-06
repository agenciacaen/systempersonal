-- Migration 030: Auto-limpar current_balance_override quando há nova transação
-- Resolve o problema do saldo travado após o user definir override manual
-- Comportamento: se o user está registrando transações, o sistema recalcula
-- automaticamente (ignora o override anterior)

CREATE OR REPLACE FUNCTION public.clear_account_balance_override()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  v_account_id := COALESCE(NEW.account_id, OLD.account_id);

  IF v_account_id IS NOT NULL THEN
    UPDATE public.accounts
       SET current_balance_override = NULL,
           balance_override_at = NULL,
           balance_override_note = NULL
     WHERE id = v_account_id
       AND current_balance_override IS NOT NULL;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_account_balance_override_insert ON public.transactions;
CREATE TRIGGER trg_clear_account_balance_override_insert
  AFTER INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_account_balance_override();

DROP TRIGGER IF EXISTS trg_clear_account_balance_override_update ON public.transactions;
CREATE TRIGGER trg_clear_account_balance_override_update
  AFTER UPDATE OF amount, type, account_id, transaction_date ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_account_balance_override();

DROP TRIGGER IF EXISTS trg_clear_account_balance_override_delete ON public.transactions;
CREATE TRIGGER trg_clear_account_balance_override_delete
  AFTER DELETE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_account_balance_override();

-- Comentário
COMMENT ON FUNCTION public.clear_account_balance_override() IS
  'Limpa o current_balance_override da conta quando uma transação é criada, alterada ou excluída, forçando o saldo a ser recalculado a partir das transações.';
