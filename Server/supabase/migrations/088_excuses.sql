-- Rename early leave to paid/unpaid excuses with time windows.

ALTER TABLE public.staff_leave_requests
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS hours numeric(6,2);

ALTER TABLE public.staff_leave_requests
  DROP CONSTRAINT IF EXISTS staff_leave_requests_leave_type_check;

ALTER TABLE public.staff_leave_requests
  ADD CONSTRAINT staff_leave_requests_leave_type_check
  CHECK (leave_type = ANY (ARRAY[
    'casual','annual','early_leave','paid_excuse','unpaid_excuse','sick','holiday','day_off','unpaid'
  ]));

-- Keep legacy early_leave rows readable; new requests use paid_excuse / unpaid_excuse.
UPDATE public.staff_leave_requests
SET leave_type = 'paid_excuse',
    hours = COALESCE(hours, 2),
    start_time = COALESCE(start_time, '15:00'::time),
    end_time = COALESCE(end_time, '17:00'::time)
WHERE leave_type = 'early_leave';
