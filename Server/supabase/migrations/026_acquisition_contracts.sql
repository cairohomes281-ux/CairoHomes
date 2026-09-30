-- 026: Phase 3 acquisition — negotiation log, contracts, comparable flag

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS is_comparable boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS units_comparable_idx
  ON public.units (is_comparable)
  WHERE is_comparable = true;

CREATE TABLE IF NOT EXISTS public.acquisition_negotiation_events (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES public.acquisition_leads(id) ON DELETE CASCADE,
  note text NOT NULL,
  proposed_price real,
  counter_price real,
  outcome varchar(40)
    CHECK (outcome IS NULL OR outcome = ANY (ARRAY[
      'pending','accepted','rejected','countered','deferred'
    ])),
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acquisition_negotiation_events_lead_idx
  ON public.acquisition_negotiation_events (lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.acquisition_contracts (
  id serial PRIMARY KEY,
  lead_id integer NOT NULL REFERENCES public.acquisition_leads(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Management agreement',
  file_url text,
  storage_ref text,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft','sent','signed','void'])),
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acquisition_contracts_lead_idx
  ON public.acquisition_contracts (lead_id);
