-- Web developers can have more than one line manager.

CREATE TABLE IF NOT EXISTS public.staff_user_managers (
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  manager_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_user_id, manager_id),
  CONSTRAINT staff_user_managers_not_self CHECK (staff_user_id <> manager_id)
);

CREATE INDEX IF NOT EXISTS staff_user_managers_manager_id_idx
  ON public.staff_user_managers (manager_id);

INSERT INTO public.staff_user_managers (staff_user_id, manager_id)
SELECT id, manager_id
FROM public.staff_users
WHERE role = 'web_developer'
  AND manager_id IS NOT NULL
ON CONFLICT DO NOTHING;
