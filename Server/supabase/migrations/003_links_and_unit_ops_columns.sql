-- 003_links_and_unit_ops_columns.sql
-- Ops columns on shared units table + helpful indexes

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS owner_email text,
  ADD COLUMN IF NOT EXISTS owner_phone text,
  ADD COLUMN IF NOT EXISTS company_commission_pct real DEFAULT 20,
  ADD COLUMN IF NOT EXISTS company_commission_owner_pct real DEFAULT 10,
  ADD COLUMN IF NOT EXISTS commission_mode varchar(10) DEFAULT 'A',
  ADD COLUMN IF NOT EXISTS commission_tenant_pct real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS utilities_cost real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ops_status varchar(50) DEFAULT 'available'
    CHECK (ops_status IS NULL OR ops_status = ANY (ARRAY['available','occupied','maintenance'])),
  ADD COLUMN IF NOT EXISTS unit_number text,
  ADD COLUMN IF NOT EXISTS project text,
  ADD COLUMN IF NOT EXISTS created_by_staff integer REFERENCES public.staff_users(id);

-- Backfill project from compound when empty
UPDATE public.units SET project = compound WHERE project IS NULL;

CREATE INDEX IF NOT EXISTS idx_units_status ON public.units (status);
CREATE INDEX IF NOT EXISTS idx_units_compound ON public.units (compound);
CREATE INDEX IF NOT EXISTS idx_units_featured ON public.units (featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS idx_bookings_dates ON public.bookings (checkin, checkout);
CREATE INDEX IF NOT EXISTS idx_reservations_unit_dates ON public.reservations (unit_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_unit_daily_prices_date ON public.unit_daily_prices (date);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON public.inquiries (status);

-- Sequence helper for allocating wp_post_id for manual units
CREATE SEQUENCE IF NOT EXISTS public.wp_post_id_seq START WITH 1000000;

CREATE OR REPLACE FUNCTION public.ensure_wp_post_id()
RETURNS trigger AS $$
BEGIN
  IF NEW.wp_post_id IS NULL THEN
    NEW.wp_post_id := nextval('public.wp_post_id_seq');
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_units_ensure_wp_post_id ON public.units;
CREATE TRIGGER trg_units_ensure_wp_post_id
  BEFORE INSERT OR UPDATE ON public.units
  FOR EACH ROW EXECUTE PROCEDURE public.ensure_wp_post_id();
