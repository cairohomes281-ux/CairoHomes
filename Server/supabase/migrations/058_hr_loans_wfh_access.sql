-- Loans, WFH requests, holiday access, extra deduction categories

ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS holiday_access varchar(20) NOT NULL DEFAULT 'auto';

ALTER TABLE public.staff_users
  DROP CONSTRAINT IF EXISTS staff_users_holiday_access_check;

ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_holiday_access_check
  CHECK (holiday_access = ANY (ARRAY['auto','granted','denied']));

ALTER TABLE public.staff_salary_deductions
  DROP CONSTRAINT IF EXISTS staff_salary_deductions_category_check;

ALTER TABLE public.staff_salary_deductions
  ADD CONSTRAINT staff_salary_deductions_category_check
  CHECK (category = ANY (ARRAY[
    'lateness','absence','delay','performance','advance','other','loan','wfh'
  ]));

CREATE TABLE IF NOT EXISTS public.staff_loan_requests (
  id serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  amount real NOT NULL CHECK (amount > 0),
  reason text,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','approved','rejected'])),
  deduct_year integer,
  deduct_month integer CHECK (deduct_month IS NULL OR (deduct_month >= 1 AND deduct_month <= 12)),
  deduction_id integer REFERENCES public.staff_salary_deductions(id) ON DELETE SET NULL,
  reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_loan_requests_status_idx
  ON public.staff_loan_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS staff_loan_requests_staff_idx
  ON public.staff_loan_requests (staff_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.staff_wfh_requests (
  id serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  reason text,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','approved','rejected'])),
  deduction_id integer REFERENCES public.staff_salary_deductions(id) ON DELETE SET NULL,
  reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_wfh_requests_status_idx
  ON public.staff_wfh_requests (status, work_date DESC);

CREATE INDEX IF NOT EXISTS staff_wfh_requests_staff_idx
  ON public.staff_wfh_requests (staff_user_id, work_date DESC);
