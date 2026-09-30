-- Guest password reset tokens (local auth / DATABASE_URL mode)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_reset_token_hash text,
  ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_password_reset_token_hash_idx
  ON public.profiles (password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;
