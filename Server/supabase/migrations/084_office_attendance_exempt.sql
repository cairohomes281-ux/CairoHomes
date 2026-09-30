-- Per-staff opt-out from office attendance tracking (role rules still apply by default).

ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS office_attendance_exempt boolean NOT NULL DEFAULT false;

UPDATE public.staff_users
SET office_attendance_exempt = true
WHERE btrim(full_name) IN ('Aya Ahmed', 'Maya El Telbany');

DELETE FROM public.staff_attendance
WHERE staff_user_id IN (
  SELECT id FROM public.staff_users WHERE office_attendance_exempt = true
);

DELETE FROM public.staff_salary_deductions
WHERE staff_user_id IN (
  SELECT id FROM public.staff_users WHERE office_attendance_exempt = true
)
  AND category IN ('lateness', 'absence');
