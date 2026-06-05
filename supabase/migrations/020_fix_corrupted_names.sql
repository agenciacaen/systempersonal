UPDATE public.categories SET name = 'Alimentação' WHERE name LIKE 'Alimenta%' AND name != 'Alimentação';
UPDATE public.categories SET name = 'Araucária' WHERE name LIKE 'Arauc%' AND name != 'Araucária';
UPDATE public.categories SET name = 'Saúde' WHERE (name LIKE 'Sa%de' OR name LIKE 'Sa?de') AND name != 'Saúde';
UPDATE public.categories SET name = 'Educação' WHERE name LIKE 'Educa%' AND name != 'Educação';
UPDATE public.categories SET name = 'Cafés' WHERE name LIKE 'Caf%' AND name != 'Cafés';
UPDATE public.categories SET name = 'Salário' WHERE name LIKE 'Sal%rio' AND name != 'Salário';
UPDATE public.categories SET name = 'Outros (Saídas)' WHERE name LIKE 'Outros%' AND name != 'Outros (Saídas)';
DELETE FROM public.categories WHERE name LIKE '%' || chr(65533) || '%';
SELECT name FROM public.categories ORDER BY name;
