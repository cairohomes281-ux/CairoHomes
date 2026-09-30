-- Unpaid leave balance. Staff can request unpaid leave without holiday access / 6-month wait.

ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS leave_unpaid_days integer NOT NULL DEFAULT 0;

ALTER TABLE public.staff_leave_requests
  DROP CONSTRAINT IF EXISTS staff_leave_requests_leave_type_check;

ALTER TABLE public.staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_leave_type_check
  CHECK (leave_type = ANY (ARRAY[
    'casual','annual','early_leave','sick','holiday','day_off','unpaid'
  ]));
