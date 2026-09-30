-- 023: Housekeeping operations — task lifecycle + inspections

CREATE TABLE IF NOT EXISTS public.housekeeping_tasks (
  id serial PRIMARY KEY,
  reservation_id integer REFERENCES public.reservations(id) ON DELETE SET NULL,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  assigned_to integer REFERENCES public.staff_users(id),
  status varchar(40) NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY[
      'pending','accepted','in_progress','submitted','needs_reclean','ready','cancelled'
    ])),
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  before_photo_urls text[] NOT NULL DEFAULT '{}',
  after_photo_urls text[] NOT NULL DEFAULT '{}',
  notes text,
  arrive_lat numeric,
  arrive_lng numeric,
  due_at timestamptz,
  accepted_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS housekeeping_tasks_unit_idx ON public.housekeeping_tasks (unit_id);
CREATE INDEX IF NOT EXISTS housekeeping_tasks_status_idx ON public.housekeeping_tasks (status);
CREATE INDEX IF NOT EXISTS housekeeping_tasks_due_idx ON public.housekeeping_tasks (due_at);
CREATE UNIQUE INDEX IF NOT EXISTS housekeeping_tasks_reservation_uidx
  ON public.housekeeping_tasks (reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.housekeeping_inspections (
  id serial PRIMARY KEY,
  task_id integer NOT NULL REFERENCES public.housekeeping_tasks(id) ON DELETE CASCADE,
  result varchar(20) NOT NULL CHECK (result = ANY (ARRAY['pass','fail'])),
  notes text,
  inspector_id integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS housekeeping_inspections_task_idx
  ON public.housekeeping_inspections (task_id);
