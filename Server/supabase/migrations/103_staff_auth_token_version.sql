-- Invalidate staff JWTs after password reset / password change.
ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS auth_token_version integer NOT NULL DEFAULT 0;
