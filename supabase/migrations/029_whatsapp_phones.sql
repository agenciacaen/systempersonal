-- Migration 029: Múltiplos números de WhatsApp por usuário
-- Substitui profiles.phone por uma tabela dedicada 1:N

CREATE TABLE IF NOT EXISTS public.whatsapp_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_phones_phone_format CHECK (phone ~ '^[0-9]{10,15}$'),
  UNIQUE(user_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_phones_user ON public.whatsapp_phones(user_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_phones_phone ON public.whatsapp_phones(phone);

-- Migrar profiles.phone existente para a nova tabela como primary + verified
INSERT INTO public.whatsapp_phones (user_id, phone, label, is_primary, verified, verified_at)
SELECT
  id,
  regexp_replace(phone, '[^0-9]', '', 'g') AS phone_clean,
  'Principal' AS label,
  true,
  true,
  now()
FROM public.profiles
WHERE phone IS NOT NULL AND phone <> ''
ON CONFLICT (user_id, phone) DO NOTHING;

-- Garantir que cada user tenha no máximo 1 primary
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_phones_one_primary
  ON public.whatsapp_phones(user_id)
  WHERE is_primary = true;

-- RLS
ALTER TABLE public.whatsapp_phones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own phones" ON public.whatsapp_phones;
CREATE POLICY "Users can manage own phones"
  ON public.whatsapp_phones
  FOR ALL
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger: garantir que sempre exista 1 primary por usuário
CREATE OR REPLACE FUNCTION public.ensure_single_primary_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  primary_count int;
BEGIN
  IF NEW.is_primary = true THEN
    UPDATE public.whatsapp_phones
       SET is_primary = false
     WHERE user_id = NEW.user_id
       AND id <> NEW.id
       AND is_primary = true;
  END IF;

  SELECT count(*) INTO primary_count
    FROM public.whatsapp_phones
   WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
     AND is_primary = true;

  IF primary_count = 0 THEN
    UPDATE public.whatsapp_phones
       SET is_primary = true
     WHERE id = (
       SELECT id FROM public.whatsapp_phones
        WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
        ORDER BY created_at ASC
        LIMIT 1
     );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_single_primary_phone ON public.whatsapp_phones;
CREATE TRIGGER trg_ensure_single_primary_phone
  AFTER INSERT OR UPDATE OR DELETE ON public.whatsapp_phones
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_single_primary_phone();

-- RPC: agente pode listar/gerenciar números do próprio usuário
CREATE OR REPLACE FUNCTION public.agent_phone_op(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_action text := payload->>'action';
  v_phone text;
  v_label text;
  v_id uuid;
  v_normalized text;
  v_result jsonb;
BEGIN
  v_user_id := (payload->>'user_id')::uuid;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_user_id');
  END IF;

  IF v_action = 'list' THEN
    SELECT jsonb_agg(row_to_json(t))
      INTO v_result
      FROM (
        SELECT id, phone, label, is_primary, verified, last_seen_at, created_at
          FROM public.whatsapp_phones
         WHERE user_id = v_user_id
         ORDER BY is_primary DESC, created_at ASC
      ) t;
    RETURN jsonb_build_object('ok', true, 'action', 'list', 'phones', COALESCE(v_result, '[]'::jsonb));
  END IF;

  v_phone := payload->>'phone';
  v_label := payload->>'label';
  v_id := (payload->>'id')::uuid;

  IF v_phone IS NOT NULL THEN
    v_normalized := regexp_replace(v_phone, '[^0-9]', '', 'g');
    IF v_normalized !~ '^[0-9]{10,15}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_phone_format');
    END IF;
  END IF;

  IF v_action = 'add' THEN
    IF v_normalized IS NULL OR v_normalized = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'phone_required');
    END IF;

    IF EXISTS (SELECT 1 FROM public.whatsapp_phones WHERE phone = v_normalized AND user_id <> v_user_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'phone_in_use_by_other_user');
    END IF;

    INSERT INTO public.whatsapp_phones (user_id, phone, label, is_primary, verified)
    VALUES (
      v_user_id,
      v_normalized,
      COALESCE(NULLIF(trim(v_label), ''), 'WhatsApp'),
      COALESCE((payload->>'is_primary')::boolean, false),
      true
    )
    ON CONFLICT (user_id, phone) DO UPDATE
      SET label = COALESCE(EXCLUDED.label, public.whatsapp_phones.label),
          is_primary = COALESCE(EXCLUDED.is_primary, public.whatsapp_phones.is_primary)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'action', 'add', 'id', v_id, 'phone', v_normalized);
  END IF;

  IF v_action = 'remove' THEN
    IF v_id IS NULL AND v_normalized IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'id_or_phone_required');
    END IF;

    DELETE FROM public.whatsapp_phones
     WHERE user_id = v_user_id
       AND (id = v_id OR (v_id IS NULL AND phone = v_normalized));

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'phone_not_found');
    END IF;

    RETURN jsonb_build_object('ok', true, 'action', 'remove');
  END IF;

  IF v_action = 'set_primary' THEN
    IF v_id IS NULL AND v_normalized IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'id_or_phone_required');
    END IF;

    UPDATE public.whatsapp_phones
       SET is_primary = true
     WHERE user_id = v_user_id
       AND (id = v_id OR (v_id IS NULL AND phone = v_normalized));

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'phone_not_found');
    END IF;

    RETURN jsonb_build_object('ok', true, 'action', 'set_primary');
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action', 'action', v_action);
END;
$$;

GRANT EXECUTE ON FUNCTION public.agent_phone_op TO anon, authenticated;
