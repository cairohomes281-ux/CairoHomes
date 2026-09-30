CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  status varchar(20) NOT NULL
    CHECK (status = ANY (ARRAY['on_time', 'late', 'no_show'])),
  check_in varchar(8),
  check_out varchar(8),
  deduction_amount real NOT NULL DEFAULT 0,
  notified boolean,
  notes text,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_user_id, work_date)
);

CREATE INDEX IF NOT EXISTS staff_attendance_date_idx
  ON public.staff_attendance (work_date DESC, staff_user_id);
