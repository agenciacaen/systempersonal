-- Seed default expense categories
insert into public.categories (name, type, color, icon, is_default) values
  ('Alimentação', 'expense', '#ef4444', 'utensils-crossed', true),
  ('Moradia', 'expense', '#f97316', 'home', true),
  ('Transporte', 'expense', '#eab308', 'car', true),
  ('Saúde', 'expense', '#22c55e', 'heart-pulse', true),
  ('Lazer', 'expense', '#3b82f6', 'gamepad-2', true),
  ('Assinaturas', 'expense', '#8b5cf6', 'repeat', true),
  ('Educação', 'expense', '#ec4899', 'book-open', true),
  ('Outros (Saídas)', 'expense', '#6b7280', 'circle', true)
on conflict do nothing;

-- Seed default income categories
insert into public.categories (name, type, color, icon, is_default) values
  ('Salário', 'income', '#22c55e', 'briefcase', true),
  ('Freelance', 'income', '#3b82f6', 'laptop', true),
  ('Investimentos', 'income', '#8b5cf6', 'trending-up', true),
  ('Outros (Entradas)', 'income', '#6b7280', 'circle', true)
on conflict do nothing;
