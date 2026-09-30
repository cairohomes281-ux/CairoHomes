-- 024: Owner portal — owner role + settlements + payout requests

DO $$
DECLARE
  conname text;
BEGIN
  FOR conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'staff_users'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.staff_users DROP CONSTRAINT %I', conname);
  END LOOP;
END $$;

ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_role_check
  CHECK (role = ANY (ARRAY['admin', 'reservations', 'resale', 'hr', 'owner']));

CREATE TABLE IF NOT EXISTS public.owner_settlements (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.staff_users(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_amount real NOT NULL DEFAULT 0,
  commission_amount real NOT NULL DEFAULT 0,
  net_amount real NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'open'
    CHECK (status = ANY (ARRAY['open','ready','paid','disputed'])),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_settlements_owner_idx ON public.owner_settlements (owner_id);
CREATE INDEX IF NOT EXISTS owner_settlements_status_idx ON public.owner_settlements (status);

CREATE TABLE IF NOT EXISTS public.owner_payout_requests (
  id serial PRIMARY KEY,
  owner_id integer NOT NULL REFERENCES public.staff_users(id),
  settlement_id integer REFERENCES public.owner_settlements(id) ON DELETE SET NULL,
  amount real NOT NULL CHECK (amount > 0),
  status varchar(20) NOT NULL DEFAULT 'requested'
    CHECK (status = ANY (ARRAY['requested','approved','rejected','paid'])),
  two_fa_verified integer NOT NULL DEFAULT 0,
  rejection_reason text,
  reviewed_by integer REFERENCES public.staff_users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_payout_requests_owner_idx ON public.owner_payout_requests (owner_id);
CREATE INDEX IF NOT EXISTS owner_payout_requests_status_idx ON public.owner_payout_requests (status);
