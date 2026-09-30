-- Operations / Housekeeping supervisor roles + daily assignment columns.

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
    'owner'
  ]));

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS ops_assigned_to integer REFERENCES public.staff_users(id),
  ADD COLUMN IF NOT EXISTS ops_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS ops_assigned_by integer REFERENCES public.staff_users(id);

CREATE INDEX IF NOT EXISTS reservations_ops_assigned_to_idx
  ON public.reservations (ops_assigned_to);

ALTER TABLE public.housekeeping_tasks
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by integer REFERENCES public.staff_users(id);

CREATE INDEX IF NOT EXISTS housekeeping_tasks_assigned_to_idx
  ON public.housekeeping_tasks (assigned_to);
