UPDATE public.categories SET tags = ARRAY['essencial','fixo','diario','novo-tag-test'] WHERE name = U&'Alimenta\00E7\00E3o' RETURNING name, tags;
