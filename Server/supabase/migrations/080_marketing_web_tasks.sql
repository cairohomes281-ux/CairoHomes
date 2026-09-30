-- Marketing and PR + Web Developer roles, and staff tasks assigned by their line manager.

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
    'unit_acquisition_agent',
    'unit_acquisition_manager',
    'operations',
    'operations_supervisor',
    'housekeeping',
    'housekeeping_supervisor',
    'resale',
    'finance',
    'hr',
    'hr_supervisor',
    'owners_relations',
    'owner',
    'marketing_pr',
    'web_developer'
  ]));

CREATE TABLE IF NOT EXISTS public.staff_tasks (
  id serial PRIMARY KEY,
  assignee_id integer NOT NULL REFERENCES public.staff_users(id),
  created_by integer NOT NULL REFERENCES public.staff_users(id),
  title varchar(255) NOT NULL,
  description text,
  deadline date NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_tasks_assignee_idx ON public.staff_tasks (assignee_id, deadline);
CREATE INDEX IF NOT EXISTS staff_tasks_created_by_idx ON public.staff_tasks (created_by);
