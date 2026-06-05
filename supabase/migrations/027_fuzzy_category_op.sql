-- Update agent_category_op to use fuzzy category lookup (handles plurals, partial matches)
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
        v_id := public.resolve_category_id(v_name);
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
        v_id := public.resolve_category_id(v_name);
        IF v_id IS NULL THEN
          RETURN jsonb_build_object('ok', false, 'error', format('Categoria "%s" não encontrada', v_name));
        END IF;
      END IF;
      SELECT name INTO v_affected_name FROM public.categories WHERE id = v_id;
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
