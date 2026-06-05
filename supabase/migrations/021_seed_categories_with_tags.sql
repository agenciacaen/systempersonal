DELETE FROM public.categories WHERE tags IS NULL OR array_length(tags, 1) IS NULL;

INSERT INTO public.categories (name, type, color, icon, tags) VALUES
  (U&'Alimenta\00E7\00E3o', 'expense', '#ef4444', 'utensils-crossed', ARRAY['essencial','fixo','diario']),
  (U&'Mercado', 'expense', '#10b981', 'shopping-cart', ARRAY['essencial','mensal']),
  (U&'Restaurante', 'expense', '#f97316', 'utensils', ARRAY['essencial','variavel']),
  (U&'Caf\00E9s', 'expense', '#a16207', 'coffee', ARRAY['essencial','diario']),
  (U&'Transporte', 'expense', '#3b82f6', 'car', ARRAY['essencial']),
  (U&'Moradia', 'expense', '#8b5cf6', 'home', ARRAY['essencial','fixo']),
  (U&'Sa\00FAde', 'expense', '#ec4899', 'heart-pulse', ARRAY['essencial','variavel']),
  (U&'Educa\00E7\00E3o', 'expense', '#0ea5e9', 'graduation-cap', ARRAY['essencial','investimento']),
  (U&'Lazer', 'expense', '#f59e0b', 'gamepad-2', ARRAY['variavel']),
  (U&'Assinaturas', 'expense', '#6366f1', 'tv', ARRAY['fixo','mensal']),
  (U&'Compras', 'expense', '#d946ef', 'shopping-bag', ARRAY['variavel']),
  (U&'Outros', 'expense', '#71717a', 'package', ARRAY[]::text[]),
  (U&'Sal\00E1rio', 'income', '#22c55e', 'briefcase', ARRAY['fixo','mensal']),
  (U&'Freelance', 'income', '#14b8a6', 'laptop', ARRAY['variavel']),
  (U&'Investimentos', 'income', '#0891b2', 'trending-up', ARRAY['investimento'])
ON CONFLICT DO NOTHING;

SELECT name, type, icon, tags FROM public.categories ORDER BY type, name;
