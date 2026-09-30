-- 041: Nanny room on units + party breakdown on reservations/bookings

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS has_nanny_room boolean NOT NULL DEFAULT false;

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS adults integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS children integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nanny_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS adults integer,
  ADD COLUMN IF NOT EXISTS children integer,
  ADD COLUMN IF NOT EXISTS nanny_count integer;

COMMENT ON COLUMN public.units.has_nanny_room IS 'Optional nanny room; capacity = beds*2+1 when true (studio still 2)';
COMMENT ON COLUMN public.reservations.nanny_count IS 'Nanny guests — excluded from beach access counts';
