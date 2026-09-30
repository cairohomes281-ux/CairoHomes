-- Paid mission leave: timed absence that does not affect attendance.

ALTER TABLE public.staff_leave_requests
  DROP CONSTRAINT IF EXISTS staff_leave_requests_leave_type_check;

ALTER TABLE public.staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_leave_type_check
  CHECK (leave_type = ANY (ARRAY[
    'casual','annual','early_leave','paid_excuse','unpaid_excuse','sick','holiday','day_off','unpaid','mission'
  ]));
