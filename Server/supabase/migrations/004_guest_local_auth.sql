-- 004_guest_local_auth.sql
-- Local guest accounts when using DATABASE_URL only (no Supabase Auth API)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_uidx
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL AND email <> '';
