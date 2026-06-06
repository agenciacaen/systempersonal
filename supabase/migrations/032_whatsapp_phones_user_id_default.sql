-- 032: adicionar DEFAULT auth.uid() em whatsapp_phones.user_id
-- (client não precisa mais enviar user_id; RLS auth.uid() = user_id passa)

ALTER TABLE public.whatsapp_phones
  ALTER COLUMN user_id SET DEFAULT auth.uid();
