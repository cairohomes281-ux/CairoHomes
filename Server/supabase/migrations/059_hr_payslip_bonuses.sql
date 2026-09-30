-- Payslip: bonuses, frozen payroll bonuses, explicit penalty category

ALTER TABLE public.staff_payroll_entries
  ADD COLUMN IF NOT EXISTS bonuses real NOT NULL DEFAULT 0;

ALTER TABLE public.staff_salary_deductions
  DROP CONSTRAINT IF EXISTS staff_salary_deductions_category_check;

ALTER TABLE public.staff_salary_deductions
  ADD CONSTRAINT staff_salary_deductions_category_check
  CHECK (category = ANY (ARRAY[
    'lateness','absence','delay','performance','advance','other','loan','wfh','penalty'
  ]));

CREATE TABLE IF NOT EXISTS public.staff_salary_bonuses (
  id serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  amount real NOT NULL CHECK (amount > 0),
  reason varchar(255) NOT NULL,
  bonus_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_salary_bonuses_staff_date_idx
  ON public.staff_salary_bonuses (staff_user_id, bonus_date DESC);
