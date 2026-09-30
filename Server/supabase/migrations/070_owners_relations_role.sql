-- Owners Relations role + reservation owner-relations checklist flags.

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
  CHECK (role = ANY (ARRAY[
    'admin',
    'reservations',
    'reservations_web',
    'reservations_manual',
    'operations',
    'operations_supervisor',
    'housekeeping',
    'housekeeping_supervisor',
    'resale',
    'hr',
    'hr_supervisor',
    'owners_relations',
    'owner'
  ]));

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS or_notified_owner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS or_ids_collected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS or_permissions_done boolean NOT NULL DEFAULT false;
