-- =====================================================
-- Migration 024: Tabela goals + RPCs agent_*
-- =====================================================
-- Estende o agente WhatsApp com operações CRUD em qualquer entidade.

-- 1) Tabela goals
CREATE TABLE IF NOT EXISTS public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_amount numeric(12,2) NOT NULL CHECK (target_amount > 0),
  current_amount numeric(12,2) NOT NULL DEFAULT 0,
  deadline date,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  icon text DEFAULT 'target',
  color text DEFAULT '#10b981',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user_id ON public.goals(user_id);
CREATE INDEX IF NOT EXISTS idx_goals_deadline ON public.goals(deadline);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_goals_updated_at ON public.goals;
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_goals_updated_at
  BEFORE UPDATE ON public.goals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "goals_select_own" ON public.goals;
CREATE POLICY "goals_select_own" ON public.goals
  FOR SELECT TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "goals_insert_own" ON public.goals;
CREATE POLICY "goals_insert_own" ON public.goals
  FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "goals_update_own" ON public.goals;
CREATE POLICY "goals_update_own" ON public.goals
  FOR UPDATE TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "goals_delete_own" ON public.goals;
CREATE POLICY "goals_delete_own" ON public.goals
  FOR DELETE TO public
  USING (auth.uid() = user_id);

-- 2) RPC agent_category_op
CREATE OR REPLACE FUNCTION public.agent_category_op(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_action text;
  v_id uuid;
  v_name text;
  v_new_name text;
  v_type text;
  v_color text;
  v_icon text;
  v_tags text[];
  v_affected_id uuid;
  v_affected_name text;
  v_usage_count int;
  v_result jsonb;
BEGIN
  v_action := payload->>'action';
  v_id := (payload->>'id')::uuid;
  v_name := payload->>'name';
  v_new_name := payload->>'new_name';
  v_type := payload->>'type';
  v_color := payload->>'color';
  v_icon := payload->>'icon';
  IF payload ? 'tags' THEN
    v_tags := ARRAY(SELECT jsonb_array_elements_text(payload->'tags'));
  END IF;

  CASE v_action
    WHEN 'create' THEN
      IF v_name IS NULL OR v_type IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'name e type são obrigatórios');
      END IF;
      IF v_type NOT IN ('income','expense') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'type deve ser "income" ou "expense"');
      END IF;
      INSERT INTO public.categories (name, type, color, icon, tags)
      VALUES (v_name, v_type, COALESCE(v_color, '#71717a'), COALESCE(v_icon, 'tag'), COALESCE(v_tags, ARRAY[]::text[]))
      RETURNING id, name INTO v_affected_id, v_affected_name;
      RETURN jsonb_build_object('ok', true, 'action', 'create', 'id', v_affected_id, 'name', v_affected_name);

    WHEN 'update' THEN
      IF v_id IS NULL AND v_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou name é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.categories WHERE name ILIKE v_name LIMIT 1;
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Categoria "%s" não encontrada', v_name));
        END IF;
      END IF;
      UPDATE public.categories
      SET name = COALESCE(v_new_name, name),
          type = COALESCE(v_type, type),
          color = COALESCE(v_color, color),
          icon = COALESCE(v_icon, icon),
          tags = COALESCE(v_tags, tags)
      WHERE id = v_id
      RETURNING id, name INTO v_affected_id, v_affected_name;
      IF v_affected_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Categoria não encontrada');
      END IF;
      RETURN jsonb_build_object('ok', true, 'action', 'update', 'id', v_affected_id, 'name', v_affected_name);

    WHEN 'delete' THEN
      IF v_id IS NULL AND v_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou name é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        SELECT id, name INTO v_id, v_affected_name FROM public.categories WHERE name ILIKE v_name LIMIT 1;
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Categoria "%s" não encontrada', v_name));
        END IF;
      ELSE
        SELECT name INTO v_affected_name FROM public.categories WHERE id = v_id;
      END IF;
      SELECT count(*) INTO v_usage_count FROM public.transactions WHERE category_id = v_id;
      DELETE FROM public.categories WHERE id = v_id;
      RETURN jsonb_build_object('ok', true, 'action', 'delete', 'id', v_id, 'name', v_affected_name, 'unlinked_transactions', v_usage_count);

    WHEN 'list' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type, 'color', color, 'icon', icon, 'tags', tags) ORDER BY type DESC, name), '[]'::jsonb)
      INTO v_result FROM public.categories;
      RETURN jsonb_build_object('ok', true, 'action', 'list', 'categories', v_result);

    ELSE
      RETURN jsonb_build_object('ok', false, 'error', format('Ação "%s" desconhecida para categoria', v_action));
  END CASE;
END;
$$;

-- 3) RPC agent_account_op
CREATE OR REPLACE FUNCTION public.agent_account_op(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_action text;
  v_user_id uuid;
  v_id uuid;
  v_name text;
  v_type text;
  v_initial_balance numeric;
  v_balance numeric;
  v_note text;
  v_affected_id uuid;
  v_affected_name text;
  v_result jsonb;
BEGIN
  v_action := payload->>'action';
  v_user_id := (payload->>'user_id')::uuid;
  v_id := (payload->>'id')::uuid;
  v_name := payload->>'name';
  v_type := payload->>'type';
  v_initial_balance := (payload->>'initial_balance')::numeric;
  v_balance := (payload->>'balance')::numeric;
  v_note := payload->>'note';

  CASE v_action
    WHEN 'create' THEN
      IF v_name IS NULL OR v_type IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'name e type são obrigatórios');
      END IF;
      IF v_type NOT IN ('checking','savings','credit','investment','cash') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'type inválido (checking|savings|credit|investment|cash)');
      END IF;
      INSERT INTO public.accounts (user_id, name, type, initial_balance, active)
      VALUES (v_user_id, v_name, v_type, COALESCE(v_initial_balance, 0), true)
      RETURNING id, name INTO v_affected_id, v_affected_name;
      RETURN jsonb_build_object('ok', true, 'action', 'create', 'id', v_affected_id, 'name', v_affected_name);

    WHEN 'set_balance' THEN
      IF v_id IS NULL AND v_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou name da conta é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        SELECT id, name INTO v_id, v_affected_name FROM public.accounts
        WHERE user_id = v_user_id AND name ILIKE v_name LIMIT 1;
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Conta "%s" não encontrada', v_name));
        END IF;
      ELSE
        SELECT name INTO v_affected_name FROM public.accounts WHERE id = v_id;
      END IF;
      UPDATE public.accounts
      SET current_balance_override = v_balance,
          balance_override_at = now(),
          balance_override_note = v_note
      WHERE id = v_id;
      RETURN jsonb_build_object('ok', true, 'action', 'set_balance', 'id', v_id, 'name', v_affected_name, 'balance', v_balance, 'note', v_note);

    WHEN 'clear_balance' THEN
      IF v_id IS NULL AND v_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou name da conta é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        SELECT id, name INTO v_id, v_affected_name FROM public.accounts
        WHERE user_id = v_user_id AND name ILIKE v_name LIMIT 1;
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Conta "%s" não encontrada', v_name));
        END IF;
      ELSE
        SELECT name INTO v_affected_name FROM public.accounts WHERE id = v_id;
      END IF;
      UPDATE public.accounts
      SET current_balance_override = NULL,
          balance_override_at = NULL,
          balance_override_note = NULL
      WHERE id = v_id;
      RETURN jsonb_build_object('ok', true, 'action', 'clear_balance', 'id', v_id, 'name', v_affected_name);

    WHEN 'list' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'type', type, 'initial_balance', initial_balance,
        'active', active, 'current_balance_override', current_balance_override
      ) ORDER BY name), '[]'::jsonb)
      INTO v_result FROM public.accounts WHERE user_id = v_user_id;
      RETURN jsonb_build_object('ok', true, 'action', 'list', 'accounts', v_result);

    ELSE
      RETURN jsonb_build_object('ok', false, 'error', format('Ação "%s" desconhecida para conta', v_action));
  END CASE;
END;
$$;

-- 4) RPC agent_goal_op
CREATE OR REPLACE FUNCTION public.agent_goal_op(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_action text;
  v_user_id uuid;
  v_id uuid;
  v_name text;
  v_new_name text;
  v_target numeric;
  v_current numeric;
  v_amount numeric;
  v_deadline date;
  v_category_id uuid;
  v_category_name text;
  v_notes text;
  v_color text;
  v_icon text;
  v_affected_id uuid;
  v_affected_name text;
  v_old_current numeric;
  v_result jsonb;
BEGIN
  v_action := payload->>'action';
  v_user_id := (payload->>'user_id')::uuid;
  v_id := (payload->>'id')::uuid;
  v_name := payload->>'name';
  v_new_name := payload->>'new_name';
  v_target := (payload->>'target_amount')::numeric;
  v_current := (payload->>'current_amount')::numeric;
  v_amount := (payload->>'amount')::numeric;
  v_deadline := (payload->>'deadline')::date;
  v_category_id := (payload->>'category_id')::uuid;
  v_category_name := payload->>'category_name';
  v_notes := payload->>'notes';
  v_color := payload->>'color';
  v_icon := payload->>'icon';

  CASE v_action
    WHEN 'create' THEN
      IF v_name IS NULL OR v_target IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'name e target_amount são obrigatórios');
      END IF;
      -- Resolve category
      IF v_category_id IS NULL AND v_category_name IS NOT NULL THEN
        SELECT id INTO v_category_id FROM public.categories WHERE name ILIKE v_category_name LIMIT 1;
      END IF;
      INSERT INTO public.goals (user_id, name, target_amount, current_amount, deadline, category_id, notes, color, icon)
      VALUES (v_user_id, v_name, v_target, COALESCE(v_current, 0), v_deadline, v_category_id, v_notes, COALESCE(v_color, '#10b981'), COALESCE(v_icon, 'target'))
      RETURNING id, name INTO v_affected_id, v_affected_name;
      RETURN jsonb_build_object('ok', true, 'action', 'create', 'id', v_affected_id, 'name', v_affected_name, 'target', v_target);

    WHEN 'update' THEN
      IF v_id IS NULL AND v_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou name da meta é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.goals WHERE user_id = v_user_id AND name ILIKE v_name LIMIT 1;
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Meta "%s" não encontrada', v_name));
        END IF;
      END IF;
      IF v_category_id IS NULL AND v_category_name IS NOT NULL THEN
        SELECT id INTO v_category_id FROM public.categories WHERE name ILIKE v_category_name LIMIT 1;
      END IF;
      UPDATE public.goals
      SET name = COALESCE(v_new_name, name),
          target_amount = COALESCE(v_target, target_amount),
          deadline = COALESCE(v_deadline, deadline),
          category_id = COALESCE(v_category_id, category_id),
          notes = COALESCE(v_notes, notes),
          color = COALESCE(v_color, color),
          icon = COALESCE(v_icon, icon)
      WHERE id = v_id AND user_id = v_user_id
      RETURNING id, name, target_amount, current_amount INTO v_affected_id, v_affected_name, v_target, v_current;
      IF v_affected_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Meta não encontrada');
      END IF;
      RETURN jsonb_build_object('ok', true, 'action', 'update', 'id', v_affected_id, 'name', v_affected_name, 'target', v_target, 'current', v_current);

    WHEN 'add_amount' THEN
      IF v_id IS NULL AND v_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou name da meta é obrigatório');
      END IF;
      IF v_amount IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'amount é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.goals WHERE user_id = v_user_id AND name ILIKE v_name LIMIT 1;
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Meta "%s" não encontrada', v_name));
        END IF;
      END IF;
      UPDATE public.goals
      SET current_amount = current_amount + v_amount
      WHERE id = v_id AND user_id = v_user_id
      RETURNING id, name, current_amount, target_amount INTO v_affected_id, v_affected_name, v_current, v_target;
      IF v_affected_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Meta não encontrada');
      END IF;
      RETURN jsonb_build_object('ok', true, 'action', 'add_amount', 'id', v_affected_id, 'name', v_affected_name, 'current', v_current, 'target', v_target, 'added', v_amount);

    WHEN 'delete' THEN
      IF v_id IS NULL AND v_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou name da meta é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        SELECT id, name INTO v_id, v_affected_name FROM public.goals WHERE user_id = v_user_id AND name ILIKE v_name LIMIT 1;
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Meta "%s" não encontrada', v_name));
        END IF;
      ELSE
        SELECT name INTO v_affected_name FROM public.goals WHERE id = v_id;
      END IF;
      DELETE FROM public.goals WHERE id = v_id AND user_id = v_user_id;
      RETURN jsonb_build_object('ok', true, 'action', 'delete', 'id', v_id, 'name', v_affected_name);

    WHEN 'list' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'target_amount', target_amount, 'current_amount', current_amount,
        'deadline', deadline, 'icon', icon, 'color', color, 'notes', notes
      ) ORDER BY deadline NULLS LAST, name), '[]'::jsonb)
      INTO v_result FROM public.goals WHERE user_id = v_user_id;
      RETURN jsonb_build_object('ok', true, 'action', 'list', 'goals', v_result);

    ELSE
      RETURN jsonb_build_object('ok', false, 'error', format('Ação "%s" desconhecida para meta', v_action));
  END CASE;
END;
$$;

-- 5) RPC agent_budget_op
CREATE OR REPLACE FUNCTION public.agent_budget_op(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_action text;
  v_user_id uuid;
  v_id uuid;
  v_category_id uuid;
  v_category_name text;
  v_month date;
  v_limit numeric;
  v_affected_id uuid;
  v_affected_label text;
  v_result jsonb;
BEGIN
  v_action := payload->>'action';
  v_user_id := (payload->>'user_id')::uuid;
  v_id := (payload->>'id')::uuid;
  v_category_id := (payload->>'category_id')::uuid;
  v_category_name := payload->>'category_name';
  v_month := (payload->>'reference_month')::date;
  v_limit := (payload->>'limit_amount')::numeric;

  CASE v_action
    WHEN 'create' THEN
      IF v_month IS NULL OR v_limit IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'reference_month e limit_amount são obrigatórios');
      END IF;
      IF v_category_id IS NULL AND v_category_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'category_id ou category_name é obrigatório');
      END IF;
      IF v_category_id IS NULL THEN
        SELECT id INTO v_category_id FROM public.categories WHERE name ILIKE v_category_name LIMIT 1;
        IF v_category_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Categoria "%s" não encontrada', v_category_name));
        END IF;
      END IF;
      INSERT INTO public.category_budgets (user_id, category_id, reference_month, limit_amount)
      VALUES (v_user_id, v_category_id, v_month, v_limit)
      ON CONFLICT (user_id, category_id, reference_month)
      DO UPDATE SET limit_amount = EXCLUDED.limit_amount
      RETURNING id INTO v_affected_id;
      RETURN jsonb_build_object('ok', true, 'action', 'create', 'id', v_affected_id, 'category_id', v_category_id, 'month', v_month, 'limit', v_limit);

    WHEN 'update' THEN
      IF v_id IS NULL AND (v_category_id IS NULL AND v_category_name IS NULL OR v_month IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou (category_id/name + month) é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        IF v_category_id IS NULL THEN
          SELECT id INTO v_category_id FROM public.categories WHERE name ILIKE v_category_name LIMIT 1;
        END IF;
        SELECT id INTO v_id FROM public.category_budgets
        WHERE user_id = v_user_id AND category_id = v_category_id AND reference_month = v_month;
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', 'Orçamento não encontrado');
        END IF;
      END IF;
      UPDATE public.category_budgets
      SET limit_amount = COALESCE(v_limit, limit_amount)
      WHERE id = v_id AND user_id = v_user_id
      RETURNING id, category_id, reference_month, limit_amount INTO v_affected_id, v_category_id, v_month, v_limit;
      IF v_affected_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Orçamento não encontrado');
      END IF;
      RETURN jsonb_build_object('ok', true, 'action', 'update', 'id', v_affected_id, 'limit', v_limit);

    WHEN 'delete' THEN
      IF v_id IS NULL AND (v_category_id IS NULL AND v_category_name IS NULL OR v_month IS NULL) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou (category_id/name + month) é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        IF v_category_id IS NULL THEN
          SELECT id INTO v_category_id FROM public.categories WHERE name ILIKE v_category_name LIMIT 1;
        END IF;
        DELETE FROM public.category_budgets
        WHERE user_id = v_user_id AND category_id = v_category_id AND reference_month = v_month
        RETURNING id INTO v_affected_id;
      ELSE
        DELETE FROM public.category_budgets WHERE id = v_id AND user_id = v_user_id
        RETURNING id INTO v_affected_id;
      END IF;
      RETURN jsonb_build_object('ok', true, 'action', 'delete', 'id', v_affected_id);

    WHEN 'list' THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', cb.id, 'category_id', cb.category_id, 'category_name', c.name,
        'reference_month', cb.reference_month, 'limit_amount', cb.limit_amount,
        'current_amount', cb.current_amount
      ) ORDER BY cb.reference_month DESC, c.name), '[]'::jsonb)
      INTO v_result FROM public.category_budgets cb
      LEFT JOIN public.categories c ON c.id = cb.category_id
      WHERE cb.user_id = v_user_id;
      RETURN jsonb_build_object('ok', true, 'action', 'list', 'budgets', v_result);

    ELSE
      RETURN jsonb_build_object('ok', false, 'error', format('Ação "%s" desconhecida para orçamento', v_action));
  END CASE;
END;
$$;

-- 6) RPC agent_transaction_op (apenas list/delete)
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
  v_count int;
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
      WHERE user_id = v_user_id
        AND id = (
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
