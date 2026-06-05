-- 018_subcategories.sql
-- Adiciona hierarquia de subcategorias:
--  - categories.parent_id (auto-relacionamento) — NULL = categoria raiz
--  - transactions.subcategory_id — aponta para a subcategoria (que é uma category com parent_id setado)
--  - CHECK: subcategoria (parent_id IS NOT NULL) deve ter mesmo type do pai
--  - CHECK: subcategoria não pode ter sub-sub (só 1 nível)
--  - View view_category_summary_month: agrega por categoria RAIZ (parent_id IS NULL)

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.categories(id) ON DELETE CASCADE;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

-- Subcategoria deve ter mesmo type do pai
ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_parent_type_match;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_parent_type_match
  FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE CASCADE
  NOT VALID;  -- existing rows may not satisfy; we just enforce going forward via trigger

-- Trigger: garante type consistente e impede sub-sub (subcategoria não pode ter parent)
CREATE OR REPLACE FUNCTION public.check_subcategory_constraints()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_type text;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    -- Subcategoria não pode ter parent (sem sub-sub)
    IF NEW.id IN (SELECT parent_id FROM public.categories WHERE parent_id IS NOT NULL) THEN
      -- Allow if it's the SAME row being updated (no-op)
      IF NOT EXISTS (SELECT 1 FROM public.categories WHERE id = NEW.parent_id AND parent_id IS NULL) THEN
        RAISE EXCEPTION 'Subcategorias não podem ter sub-subcategorias (parent_id deve apontar para categoria raiz)';
      END IF;
    END IF;
    -- Type deve bater com o pai
    SELECT type INTO parent_type FROM public.categories WHERE id = NEW.parent_id;
    IF parent_type IS NULL THEN
      RAISE EXCEPTION 'Categoria pai não encontrada';
    END IF;
    IF parent_type <> NEW.type THEN
      RAISE EXCEPTION 'Subcategoria deve ter o mesmo tipo (type) da categoria pai';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_subcategory ON public.categories;
CREATE TRIGGER trg_check_subcategory
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.check_subcategory_constraints();

-- ============================================================
-- View: agora agrega por categoria RAIZ
-- Para subcategorias, agrupa o total na categoria pai
-- ============================================================
DROP VIEW IF EXISTS public.view_category_summary_month;

CREATE VIEW public.view_category_summary_month AS
SELECT
  t.user_id,
  t.competence_month,
  root_cat.id            AS category_id,
  root_cat.name          AS category_name,
  root_cat.color         AS category_color,
  root_cat.icon          AS category_icon,
  COALESCE(SUM(t.amount), 0) AS total_amount,
  COUNT(t.id)            AS transaction_count,
  CASE
    WHEN COALESCE(SUM(t.amount), 0) = 0 THEN 0
    ELSE (
      COALESCE(SUM(t.amount), 0) /
      NULLIF(
        (SELECT SUM(t2.amount)
         FROM public.transactions t2
         JOIN public.categories c2 ON c2.id = COALESCE(t2.category_id, t2.subcategory_id)
         WHERE c2.parent_id IS NULL
           AND c2.type = root_cat.type
           AND t2.user_id = t.user_id
           AND t2.competence_month = t.competence_month
           AND t2.status = 'confirmed'),
        0
      )
    ) * 100
  END AS percentage_of_expense
FROM public.transactions t
JOIN public.categories sc
  ON sc.id = COALESCE(t.subcategory_id, t.category_id)  -- effective category
JOIN public.categories root_cat
  ON root_cat.id = COALESCE(sc.parent_id, sc.id)        -- walk up to root
WHERE t.status = 'confirmed'
GROUP BY t.user_id, t.competence_month, root_cat.id, root_cat.name, root_cat.color, root_cat.icon;

GRANT SELECT ON public.view_category_summary_month TO anon, authenticated, service_role;

-- ============================================================
-- View auxiliar: lista subcategorias com info do pai
-- ============================================================
DROP VIEW IF EXISTS public.view_categories_with_subcategories;

CREATE VIEW public.view_categories_with_subcategories AS
SELECT
  c.id,
  c.user_id,
  c.name,
  c.type,
  c.color,
  c.icon,
  c.parent_id,
  c.is_default,
  c.created_at,
  p.name AS parent_name,
  p.icon AS parent_icon,
  p.color AS parent_color,
  (c.parent_id IS NOT NULL) AS is_subcategory,
  (SELECT COUNT(*) FROM public.categories sub WHERE sub.parent_id = c.id) AS subcategory_count
FROM public.categories c
LEFT JOIN public.categories p ON p.id = c.parent_id;

GRANT SELECT ON public.view_categories_with_subcategories TO anon, authenticated, service_role;
