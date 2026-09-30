-- Reservations Manager role. Agents they manage are linked via staff_users.manager_id
-- (the former "line manager" field for reservation staff).

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
    'reservations_manager',
    'operations',
    'operations_supervisor',
    'housekeeping',
    'housekeeping_supervisor',
    'resale',
    'finance',
    'hr',
    'hr_supervisor',
    'owners_relations',
    'owner'
  ]));
