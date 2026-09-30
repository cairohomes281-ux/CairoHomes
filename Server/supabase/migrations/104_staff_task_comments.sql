-- Threaded replies on staff tasks (assignee / creator discussion).
CREATE TABLE IF NOT EXISTS public.staff_task_comments (
  id serial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES public.staff_tasks(id) ON DELETE CASCADE,
  author_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_task_comments_body_nonempty CHECK (btrim(body) <> '')
);

CREATE INDEX IF NOT EXISTS staff_task_comments_task_id_idx
  ON public.staff_task_comments (task_id, created_at ASC);
