-- Manual finance calendar payments (accounting items stay live-synced, not stored here).
CREATE TABLE IF NOT EXISTS public.finance_calendar_payments (
  id serial PRIMARY KEY,
  title varchar(255) NOT NULL,
  amount numeric(14, 2) NOT NULL DEFAULT 0,
  currency varchar(8) NOT NULL DEFAULT 'EGP',
  due_date date NOT NULL,
  direction varchar(8) NOT NULL DEFAULT 'out'
    CHECK (direction IN ('out', 'in')),
  category varchar(64),
  status varchar(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled')),
  paid_at timestamptz,
  notes text,
  account_code varchar(16),
  related_ref text,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  updated_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_calendar_payments_title_nonempty CHECK (btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS finance_calendar_payments_due_date_idx
  ON public.finance_calendar_payments (due_date);

CREATE INDEX IF NOT EXISTS finance_calendar_payments_status_idx
  ON public.finance_calendar_payments (status);
