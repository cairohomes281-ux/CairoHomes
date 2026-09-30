-- Monthly booking targets for reservation agents.
-- Hit target → salary bonus; miss → performance deduction.

CREATE TABLE IF NOT EXISTS public.staff_reservation_targets (
  id serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  period_year integer NOT NULL CHECK (period_year >= 2020 AND period_year <= 2100),
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  target_bookings integer NOT NULL CHECK (target_bookings >= 0),
  bonus_amount real NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  deduction_amount real NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  status varchar(20) NOT NULL DEFAULT 'open'
    CHECK (status = ANY (ARRAY['open'::text, 'applied'::text])),
  bookings_count integer,
  applied_bonus_id integer REFERENCES public.staff_salary_bonuses(id) ON DELETE SET NULL,
  applied_deduction_id integer REFERENCES public.staff_salary_deductions(id) ON DELETE SET NULL,
  applied_at timestamptz,
  applied_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_user_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_staff_reservation_targets_period
  ON public.staff_reservation_targets (period_year, period_month);

CREATE INDEX IF NOT EXISTS idx_staff_reservation_targets_staff
  ON public.staff_reservation_targets (staff_user_id);
