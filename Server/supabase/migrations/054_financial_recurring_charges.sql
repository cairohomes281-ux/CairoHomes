-- Monthly automatic operating charges (rent, campus utilities, buffet).
-- Owner distributions are computed from stays / payouts, not stored here.

CREATE TABLE IF NOT EXISTS public.financial_recurring_charges (
  kind varchar(40) PRIMARY KEY
    CHECK (kind = ANY (ARRAY['rent'::text, 'utilities'::text, 'buffet'::text])),
  label varchar(120) NOT NULL,
  account_code varchar(16) NOT NULL,
  amount_egp real NOT NULL DEFAULT 0 CHECK (amount_egp >= 0),
  day_of_month integer NOT NULL DEFAULT 1 CHECK (day_of_month >= 1 AND day_of_month <= 28),
  is_active integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer REFERENCES public.staff_users(id)
);

INSERT INTO public.financial_recurring_charges (kind, label, account_code, amount_egp)
VALUES
  ('rent', 'Office rent', '604000', 0),
  ('utilities', 'Company campus utilities', '608000', 0),
  ('buffet', 'Staff buffet & meals', '508000', 0)
ON CONFLICT (kind) DO NOTHING;
