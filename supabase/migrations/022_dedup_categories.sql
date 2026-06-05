-- Remove categorias duplicadas/corrompidas (mantém apenas a que tem U-escape correto)
-- Critério: manter a entrada com nome ASCII-only (sem caracteres de replacement)
DO $$
DECLARE
  cat RECORD;
BEGIN
  FOR cat IN
    SELECT id, name FROM public.categories
    WHERE name ~ '[^\x00-\x7F]' AND ascii(name) < 32  -- tem caractere de replacement (U+FFFD) ou similar
       OR octet_length(name) != length(name)  -- tem multi-byte corrompido
  LOOP
    -- Tenta achar a versão ASCII-safe
    IF EXISTS (SELECT 1 FROM public.categories WHERE name = replace(cat.name, chr(65533), 'ç') AND id != cat.id) THEN
      DELETE FROM public.categories WHERE id = cat.id;
    END IF;
  END LOOP;
END $$;

-- Delete por nome corrompido especifico (mantem a versao sem corrupcao)
DELETE FROM public.categories WHERE name = U&'Alimenta\FFFD\FFFD\FFFD\FFFDo' OR name LIKE U&'Alimenta%' || chr(65533) || U&'%';
DELETE FROM public.categories WHERE name LIKE U&'Sa\00FA%' || chr(65533) || U&'%';
DELETE FROM public.categories WHERE name LIKE U&'Caf%' || chr(65533) || U&'%';
DELETE FROM public.categories WHERE name LIKE U&'Sal%' || chr(65533) || U&'%';
DELETE FROM public.categories WHERE name LIKE U&'Educa%' || chr(65533) || U&'%';

-- Desduplica por (name, type): mantém a primeira
DELETE FROM public.categories a USING public.categories b
WHERE a.name = b.name AND a.type = b.type AND a.id > b.id;

SELECT name, type, icon, tags FROM public.categories ORDER BY type, name;
