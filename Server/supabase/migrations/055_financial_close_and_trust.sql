-- Period close, bank reconciliation, owner holdbacks, gateway MDR setting

CREATE TABLE IF NOT EXISTS public.financial_period_closes (
  year_month varchar(7) PRIMARY KEY,
  pnl_amount real NOT NULL DEFAULT 0,
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by integer REFERENCES public.staff_users(id),
  notes text
);

CREATE TABLE IF NOT EXISTS public.financial_reconciled_entries (
  entry_id text PRIMARY KEY,
  account_code varchar(16) NOT NULL,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  reconciled_by integer REFERENCES public.staff_users(id)
);

CREATE TABLE IF NOT EXISTS public.financial_bank_snapshots (
  id serial PRIMARY KEY,
  account_code varchar(16) NOT NULL,
  statement_date date NOT NULL,
  statement_balance real NOT NULL,
  notes text,
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_owner_holdbacks (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.staff_users(id),
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  amount real NOT NULL CHECK (amount > 0),
  reason text,
  is_released integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer REFERENCES public.staff_users(id)
);

CREATE TABLE IF NOT EXISTS public.financial_settings (
  key varchar(40) PRIMARY KEY,
  value_num real,
  value_text text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.financial_settings (key, value_num) VALUES
  ('gateway_mdr_pct', 1.5)
ON CONFLICT (key) DO NOTHING;
