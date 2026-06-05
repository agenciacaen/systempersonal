-- 017_fix_corrupted_category_names.sql
-- Corrige 6 nomes de categoria default corrompidos por encoding (Latin-1 → U+FFFD)
-- na inserção original. Cada par de U+FFFD = 1 caractere acentuado que se perdeu.

UPDATE public.categories
SET name = U&'Alimenta\00E7\00E3o'
WHERE encode(convert_to(name, 'UTF8'), 'hex') LIKE '416c696d656e7461%'
  AND encode(convert_to(name, 'UTF8'), 'hex') LIKE '%efbfbdefbfbd6f';

UPDATE public.categories
SET name = U&'Sa\00FAde'
WHERE encode(convert_to(name, 'UTF8'), 'hex') = '5361efbfbd6465';

UPDATE public.categories
SET name = U&'Educa\00E7\00E3o'
WHERE encode(convert_to(name, 'UTF8'), 'hex') = '4564756361efbfbdefbfbd6f';

UPDATE public.categories
SET name = U&'Outros (Sa\00EDdas)'
WHERE encode(convert_to(name, 'UTF8'), 'hex') = '4f7574726f7320285361efbfbd64617329';

UPDATE public.categories
SET name = U&'Sal\00E1rio'
WHERE encode(convert_to(name, 'UTF8'), 'hex') = '53616cefbfbd72696f';

UPDATE public.categories
SET name = U&'Caf\00E9s'
WHERE encode(convert_to(name, 'UTF8'), 'hex') = '436166efbfbd73';
