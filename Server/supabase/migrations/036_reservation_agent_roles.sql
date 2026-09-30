-- Split reservation team into website vs manual agents.
-- reservations_web  = website bookings only
-- reservations_manual = manual PMS reservations only
-- Legacy "reservations" remains valid for dual-access accounts.

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
    'resale',
    'hr',
    'owner'
  ]));
