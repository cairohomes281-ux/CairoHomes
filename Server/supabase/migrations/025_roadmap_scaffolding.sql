-- 025: Roadmap scaffolding — acquisition, pricing audit, maintenance

CREATE TABLE IF NOT EXISTS public.acquisition_leads (
  id serial PRIMARY KEY,
  title text NOT NULL,
  owner_name text,
  owner_phone text,
  owner_email text,
  destination text,
  project text,
  property_type text,
  beds integer,
  baths integer,
  expected_price real,
  stage varchar(40) NOT NULL DEFAULT 'lead'
    CHECK (stage = ANY (ARRAY[
      'lead','under_evaluation','pricing_recommended','proposal_sent',
      'negotiation','contract_signed','content_pending','ready','live'
    ])),
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  notes text,
  sla_due_at timestamptz,
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acquisition_leads_stage_idx ON public.acquisition_leads (stage);

CREATE TABLE IF NOT EXISTS public.pricing_recommendations (
  id serial PRIMARY KEY,
  unit_id uuid REFERENCES public.units(id) ON DELETE CASCADE,
  lead_id integer REFERENCES public.acquisition_leads(id) ON DELETE CASCADE,
  base_price real,
  weekday_price real,
  weekend_price real,
  peak_price real,
  floor_price real,
  ceiling_price real,
  confidence numeric(4,2) DEFAULT 0,
  reasoning jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft','presented','accepted','rejected','superseded'])),
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (unit_id IS NOT NULL OR lead_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS pricing_recommendations_unit_idx ON public.pricing_recommendations (unit_id);

CREATE TABLE IF NOT EXISTS public.price_change_log (
  id serial PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  price_date date NOT NULL,
  old_price real,
  new_price real,
  currency text NOT NULL DEFAULT 'EGP',
  source text,
  reason text,
  actor_id integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS price_change_log_unit_date_idx
  ON public.price_change_log (unit_id, price_date DESC);

CREATE TABLE IF NOT EXISTS public.maintenance_tickets (
  id serial PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  severity varchar(20) NOT NULL DEFAULT 'medium'
    CHECK (severity = ANY (ARRAY['low','medium','high','urgent'])),
  status varchar(20) NOT NULL DEFAULT 'open'
    CHECK (status = ANY (ARRAY['open','assigned','in_progress','resolved','closed','cancelled'])),
  vendor_name text,
  cost_amount real DEFAULT 0,
  housekeeping_task_id integer REFERENCES public.housekeeping_tasks(id) ON DELETE SET NULL,
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_tickets_unit_idx ON public.maintenance_tickets (unit_id);
CREATE INDEX IF NOT EXISTS maintenance_tickets_status_idx ON public.maintenance_tickets (status);
