-- 010: HR role + staff identity / salary / first-login fields

-- Expand role CHECK to include hr
DO $$
DECLARE
  conname text;
BEGIN
  FOR conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'staff_users'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.staff_users DROP CONSTRAINT %I', conname);
  END LOOP;
END $$;

ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_role_check
  CHECK (role = ANY (ARRAY['admin', 'reservations', 'resale', 'hr']));

ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS staff_code varchar(20),
  ADD COLUMN IF NOT EXISTS base_salary real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_base_salary real,
  ADD COLUMN IF NOT EXISTS salary_change_status varchar(20) DEFAULT 'none'
    CHECK (salary_change_status IS NULL OR salary_change_status = ANY (ARRAY['none','pending','approved','rejected'])),
  ADD COLUMN IF NOT EXISTS is_first_login integer NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS staff_users_staff_code_uidx
  ON public.staff_users (staff_code)
  WHERE staff_code IS NOT NULL;

-- Existing admins keep unrestricted access (no forced password change)
UPDATE public.staff_users
SET is_first_login = 0
WHERE is_first_login IS NULL OR role = 'admin';
