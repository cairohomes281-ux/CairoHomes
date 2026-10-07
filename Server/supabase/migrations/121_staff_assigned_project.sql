-- Operations agents work one project; check-ins are only assignable within it.
ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS assigned_project text;
