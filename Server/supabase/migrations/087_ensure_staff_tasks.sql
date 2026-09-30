-- Ensure staff task tables exist (safe to re-run).

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

CREATE TABLE IF NOT EXISTS public.staff_user_managers (
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  manager_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_user_id, manager_id),
  CONSTRAINT staff_user_managers_not_self CHECK (staff_user_id <> manager_id)
);

CREATE INDEX IF NOT EXISTS staff_user_managers_manager_id_idx
  ON public.staff_user_managers (manager_id);
