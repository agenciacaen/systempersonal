-- Improve category lookup in agent RPCs to be more flexible (handles plurals, partial matches)
-- Uses ILIKE with both prefix and suffix patterns

CREATE OR REPLACE FUNCTION public.resolve_category_id(p_name text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN NULL;
  END IF;
  -- Tenta match exato primeiro
  SELECT id INTO v_id FROM public.categories WHERE LOWER(name) = LOWER(p_name) LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  -- Tenta match prefix/suffix (lida com plurais: "restaurantes" -> "restaurante")
  SELECT id INTO v_id FROM public.categories
  WHERE LOWER(name) LIKE LOWER(p_name) || '%'
     OR LOWER(name) LIKE '%' || LOWER(p_name)
  ORDER BY LENGTH(name) ASC
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  -- Tenta inverse
  SELECT id INTO v_id FROM public.categories
  WHERE LOWER(p_name) LIKE LOWER(name) || '%'
     OR LOWER(p_name) LIKE '%' || LOWER(name)
  ORDER BY LENGTH(name) DESC
  LIMIT 1;
  RETURN v_id;
END;
$$;

-- Recompila agent_budget_op usando resolve_category_id
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
        v_category_id := public.resolve_category_id(v_category_name);
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
          v_category_id := public.resolve_category_id(v_category_name);
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
          v_category_id := public.resolve_category_id(v_category_name);
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

-- Recompila agent_goal_op com resolve_category_id
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
  v_target_ret numeric;
  v_current_ret numeric;
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
      IF v_category_id IS NULL AND v_category_name IS NOT NULL THEN
        v_category_id := public.resolve_category_id(v_category_name);
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
        SELECT id INTO v_id FROM public.goals WHERE user_id = v_user_id AND LOWER(name) = LOWER(v_name) LIMIT 1;
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Meta "%s" não encontrada', v_name));
        END IF;
      END IF;
      IF v_category_id IS NULL AND v_category_name IS NOT NULL THEN
        v_category_id := public.resolve_category_id(v_category_name);
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
      RETURNING id, name, target_amount, current_amount INTO v_affected_id, v_affected_name, v_target_ret, v_current_ret;
      IF v_affected_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Meta não encontrada');
      END IF;
      RETURN jsonb_build_object('ok', true, 'action', 'update', 'id', v_affected_id, 'name', v_affected_name, 'target', v_target_ret, 'current', v_current_ret);

    WHEN 'add_amount' THEN
      IF v_id IS NULL AND v_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou name da meta é obrigatório');
      END IF;
      IF v_amount IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'amount é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.goals WHERE user_id = v_user_id AND LOWER(name) = LOWER(v_name) LIMIT 1;
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Meta "%s" não encontrada', v_name));
        END IF;
      END IF;
      UPDATE public.goals
      SET current_amount = current_amount + v_amount
      WHERE id = v_id AND user_id = v_user_id
      RETURNING id, name, current_amount, target_amount INTO v_affected_id, v_affected_name, v_current_ret, v_target_ret;
      IF v_affected_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Meta não encontrada');
      END IF;
      RETURN jsonb_build_object('ok', true, 'action', 'add_amount', 'id', v_affected_id, 'name', v_affected_name, 'current', v_current_ret, 'target', v_target_ret, 'added', v_amount);

    WHEN 'delete' THEN
      IF v_id IS NULL AND v_name IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'id ou name da meta é obrigatório');
      END IF;
      IF v_id IS NULL THEN
        SELECT id, name INTO v_id, v_affected_name FROM public.goals WHERE user_id = v_user_id AND LOWER(name) = LOWER(v_name) LIMIT 1;
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
