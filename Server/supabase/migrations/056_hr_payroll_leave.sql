-- HR payroll, staff deductions, and leave requests (tied to staff_users)

CREATE TABLE IF NOT EXISTS public.staff_salary_deductions (
  id serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  amount real NOT NULL CHECK (amount > 0),
  reason varchar(255) NOT NULL,
  deduction_date date NOT NULL DEFAULT CURRENT_DATE,
  category varchar(50) NOT NULL DEFAULT 'other'
    CHECK (category = ANY (ARRAY['delay','performance','advance','absence','other'])),
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_salary_deductions_staff_date_idx
  ON public.staff_salary_deductions (staff_user_id, deduction_date DESC);

CREATE TABLE IF NOT EXISTS public.staff_leave_requests (
  id serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  leave_type varchar(50) NOT NULL DEFAULT 'holiday'
    CHECK (leave_type = ANY (ARRAY['holiday','day_off','sick'])),
  start_date date NOT NULL,
  end_date date NOT NULL,
  days integer NOT NULL CHECK (days >= 1),
  reason text,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','approved','rejected'])),
  reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT staff_leave_date_order CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS staff_leave_requests_status_idx
  ON public.staff_leave_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS staff_leave_requests_staff_idx
  ON public.staff_leave_requests (staff_user_id, start_date DESC);

CREATE TABLE IF NOT EXISTS public.staff_payroll_entries (
  id serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  period_year integer NOT NULL,
  period_month integer NOT NULL CHECK (period_month >= 1 AND period_month <= 12),
  base_salary real NOT NULL,
  deductions real NOT NULL DEFAULT 0,
  net_pay real NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'paid'
    CHECK (status = ANY (ARRAY['draft','paid'])),
  paid_at timestamptz,
  paid_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (staff_user_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS staff_payroll_entries_period_idx
  ON public.staff_payroll_entries (period_year, period_month);
