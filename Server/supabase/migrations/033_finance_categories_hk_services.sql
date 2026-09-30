-- 033: expense expense categories + outsider housekeeping service orders

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS category varchar(40) NOT NULL DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expenses_category_check'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_category_check
      CHECK (category = ANY (ARRAY[
        'marketing'::text,
        'salary'::text,
        'housekeeping_cost'::text,
        'other'::text
      ]));
  END IF;
END $$;

-- Allow company-level ledgers (marketing / salary) without a unit
ALTER TABLE public.expenses
  ALTER COLUMN unit_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS expenses_category_idx
  ON public.expenses (category);

CREATE INDEX IF NOT EXISTS expenses_category_date_idx
  ON public.expenses (category, expense_date);

CREATE TABLE IF NOT EXISTS public.housekeeping_service_orders (
  id serial PRIMARY KEY,
  client_name varchar(255) NOT NULL,
  client_phone varchar(100),
  unit_number text NOT NULL,
  amount real NOT NULL CHECK (amount >= 0),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'requested'
    CHECK (status = ANY (ARRAY[
      'requested'::text,
      'scheduled'::text,
      'done'::text,
      'cancelled'::text
    ])),
  notes text,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT housekeeping_service_orders_period_check
    CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS housekeeping_service_orders_period_idx
  ON public.housekeeping_service_orders (period_start, period_end);

CREATE INDEX IF NOT EXISTS housekeeping_service_orders_status_idx
  ON public.housekeeping_service_orders (status);
