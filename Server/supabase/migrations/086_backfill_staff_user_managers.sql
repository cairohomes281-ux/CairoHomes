-- Mirror primary manager_id into staff_user_managers so task scope works for all staff.
INSERT INTO public.staff_user_managers (staff_user_id, manager_id)
SELECT id, manager_id
FROM public.staff_users
WHERE manager_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Ensure web developers with multiple managers keep every assigned manager in the junction table.
INSERT INTO public.staff_user_managers (staff_user_id, manager_id)
SELECT su.id, su.manager_id
FROM public.staff_users su
WHERE su.role = 'web_developer'
  AND su.manager_id IS NOT NULL
ON CONFLICT DO NOTHING;
