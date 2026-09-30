-- 007_three_staff_roles.sql
-- Collapse staff_users.role to admin | reservations | resale

-- Remap existing roles before tightening the CHECK constraint
UPDATE public.staff_users
SET role = CASE role
  WHEN 'admin' THEN 'admin'
  WHEN 'finance' THEN 'admin'
  WHEN 'operation_manager' THEN 'admin'
  WHEN 'hr' THEN 'admin'
  WHEN 'acquisition_reservation' THEN 'reservations'
  WHEN 'broker' THEN 'reservations'
  WHEN 'sales' THEN 'reservations'
  WHEN 'owner_experience' THEN 'resale'
  ELSE role
END
WHERE role IN (
  'admin', 'finance', 'operation_manager', 'hr',
  'acquisition_reservation', 'broker', 'sales', 'owner_experience'
);

-- Deactivate owner accounts (no longer a valid staff role)
UPDATE public.staff_users
SET is_active = 0,
    updated_at = now()
WHERE role = 'owner';

-- Drop any existing CHECK on staff_users.role
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

-- Owners still have role='owner' but are inactive; remap them to resale for CHECK compliance
-- (they remain deactivated)
UPDATE public.staff_users
SET role = 'resale',
    updated_at = now()
WHERE role = 'owner';

ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_role_check
  CHECK (role = ANY (ARRAY['admin', 'reservations', 'resale']));
