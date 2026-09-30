-- Allow assignees to mark staff tasks as done.

ALTER TABLE public.staff_tasks
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS staff_tasks_open_assignee_idx
  ON public.staff_tasks (assignee_id, deadline)
  WHERE completed_at IS NULL;
