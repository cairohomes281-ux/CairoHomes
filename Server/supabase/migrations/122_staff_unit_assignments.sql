-- Operations agents are assigned specific units (replaces the single assigned_project).
CREATE TABLE IF NOT EXISTS public.staff_unit_assignments (
  staff_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, unit_id)
);

CREATE INDEX IF NOT EXISTS staff_unit_assignments_unit_idx
  ON public.staff_unit_assignments (unit_id);

ALTER TABLE public.staff_unit_assignments ENABLE ROW LEVEL SECURITY;

INSERT INTO public.staff_unit_assignments (staff_id, unit_id)
SELECT s.id, u.id
FROM public.staff_users s
JOIN public.units u
  ON lower(btrim(COALESCE(u.project, u.compound, ''))) = lower(btrim(s.assigned_project))
WHERE s.role = 'operations'
  AND s.assigned_project IS NOT NULL
  AND btrim(s.assigned_project) <> ''
ON CONFLICT DO NOTHING;

ALTER TABLE public.staff_users DROP COLUMN IF EXISTS assigned_project;
