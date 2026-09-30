-- 006_hybrid_ops.sql
-- Optional extras for hybrid PMS + guest booking.
-- App currently works without this migration:
--   location_link → units.source_url
--   facilities → merged into units.amenities
--   reject → bookings.status = cancelled + cancellation_reason
-- Apply when you want dedicated columns / rejected status.

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS location_link text,
  ADD COLUMN IF NOT EXISTS facilities text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS assigned_sales_id integer REFERENCES public.staff_users(id),
  ADD COLUMN IF NOT EXISTS commission_snapshot jsonb;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (status = ANY (ARRAY['confirmed','cancelled','pending','held','rejected']));
