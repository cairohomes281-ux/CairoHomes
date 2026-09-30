-- Manual revenue, expense, and miscellaneous lines entered from Financial System

CREATE TABLE IF NOT EXISTS public.financial_manual_entries (
  id serial PRIMARY KEY,
  entry_type varchar(20) NOT NULL
    CHECK (entry_type = ANY (ARRAY['revenue'::text, 'expense'::text, 'miscellaneous'::text])),
  misc_flow varchar(10),
  description text NOT NULL,
  amount real NOT NULL CHECK (amount > 0),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_manual_entries_misc_flow_type_check
    CHECK (
      (entry_type = 'miscellaneous' AND misc_flow = ANY (ARRAY['in'::text, 'out'::text]))
      OR (entry_type <> 'miscellaneous' AND misc_flow IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS financial_manual_entries_date_idx
  ON public.financial_manual_entries (entry_date DESC);

CREATE INDEX IF NOT EXISTS financial_manual_entries_type_idx
  ON public.financial_manual_entries (entry_type);
