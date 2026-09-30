-- HR policy: daily-rate deductions, leave balances, leave types

ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS leave_casual_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leave_annual_days integer NOT NULL DEFAULT 0;

ALTER TABLE public.staff_salary_deductions
  ADD COLUMN IF NOT EXISTS arrival_time time,
  ADD COLUMN IF NOT EXISTS notified boolean,
  ADD COLUMN IF NOT EXISTS daily_rate real,
  ADD COLUMN IF NOT EXISTS days_factor real;

ALTER TABLE public.staff_salary_deductions
  DROP CONSTRAINT IF EXISTS staff_salary_deductions_category_check;

ALTER TABLE public.staff_salary_deductions
  ADD CONSTRAINT staff_salary_deductions_category_check
  CHECK (category = ANY (ARRAY[
    'lateness','absence','delay','performance','advance','other'
  ]));

ALTER TABLE public.staff_leave_requests
  DROP CONSTRAINT IF EXISTS staff_leave_requests_leave_type_check;

ALTER TABLE public.staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_leave_type_check
  CHECK (leave_type = ANY (ARRAY[
    'casual','annual','early_leave','sick','holiday','day_off'
  ]));
