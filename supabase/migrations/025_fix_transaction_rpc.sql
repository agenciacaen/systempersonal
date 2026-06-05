-- Fix transaction_op list query
CREATE OR REPLACE FUNCTION public.agent_transaction_op(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_action text;
  v_user_id uuid;
  v_id uuid;
  v_days int;
  v_limit int;
  v_type_filter text;
  v_result jsonb;
  v_affected_id uuid;
  v_affected_desc text;
BEGIN
  v_action := payload->>'action';
  v_user_id := (payload->>'user_id')::uuid;
  v_id := (payload->>'id')::uuid;
  v_days := coalesce((payload->>'days')::int, 7);
  v_limit := coalesce((payload->>'limit')::int, 20);
  v_type_filter := payload->>'type';

  CASE v_action
    WHEN 'list' THEN
      WITH recent AS (
        SELECT jsonb_build_object(
          'id', t.id, 'type', t.type, 'amount', t.amount, 'description', t.description,
          'transaction_date', t.transaction_date, 'category_name', c.name, 'category_icon', c.icon,
          'category_color', c.color, 'account_name', a.name
        ) AS row_data,
        t.transaction_date AS sort_date
        FROM public.transactions t
        LEFT JOIN public.categories c ON c.id = t.category_id
        LEFT JOIN public.accounts a ON a.id = t.account_id
        WHERE t.user_id = v_user_id
          AND t.transaction_date >= current_date - (v_days || ' days')::interval
          AND (v_type_filter IS NULL OR t.type = v_type_filter)
        ORDER BY t.transaction_date DESC, t.created_at DESC
        LIMIT v_limit
      )
      SELECT coalesce(jsonb_agg(row_data ORDER BY sort_date DESC), '[]'::jsonb) INTO v_result FROM recent;
      RETURN jsonb_build_object('ok', true, 'action', 'list', 'transactions', v_result, 'days', v_days);

    WHEN 'delete' THEN
      IF v_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id da transação é obrigatório');
      END IF;
      SELECT description INTO v_affected_desc FROM public.transactions WHERE id = v_id AND user_id = v_user_id;
      IF v_affected_desc IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Transação não encontrada');
      END IF;
      DELETE FROM public.transactions WHERE id = v_id AND user_id = v_user_id;
      RETURN jsonb_build_object('ok', true, 'action', 'delete', 'id', v_id, 'description', v_affected_desc);

    WHEN 'delete_recent' THEN
      DELETE FROM public.transactions
      WHERE id = (
        SELECT id FROM public.transactions
        WHERE user_id = v_user_id
        ORDER BY created_at DESC LIMIT 1
      )
      RETURNING id, description INTO v_affected_id, v_affected_desc;
      IF v_affected_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Nenhuma transação recente');
      END IF;
      RETURN jsonb_build_object('ok', true, 'action', 'delete_recent', 'id', v_affected_id, 'description', v_affected_desc);

    ELSE
      RETURN jsonb_build_object('ok', false, 'error', format('Ação "%s" desconhecida para transação', v_action));
  END CASE;
END;
$$;
