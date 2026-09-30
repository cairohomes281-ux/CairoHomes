-- Cairo Homes points + mid-stay guest housekeeping requests

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS home_points integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.home_points_ledger (
  id serial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  points integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS home_points_ledger_booking_earn_uidx
  ON public.home_points_ledger (booking_id)
  WHERE booking_id IS NOT NULL AND points > 0;

CREATE INDEX IF NOT EXISTS home_points_ledger_profile_idx
  ON public.home_points_ledger (profile_id);

ALTER TABLE public.housekeeping_tasks
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'pre_arrival',
  ADD COLUMN IF NOT EXISTS requested_time text,
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

ALTER TABLE public.housekeeping_tasks
  DROP CONSTRAINT IF EXISTS housekeeping_tasks_source_check;

ALTER TABLE public.housekeeping_tasks
  ADD CONSTRAINT housekeeping_tasks_source_check
  CHECK (source = ANY (ARRAY['pre_arrival', 'guest_request']));

DROP INDEX IF EXISTS public.housekeeping_tasks_reservation_uidx;

-- One pre-arrival task per reservation; guest mid-stay requests can stack
CREATE UNIQUE INDEX IF NOT EXISTS housekeeping_tasks_pre_arrival_uidx
  ON public.housekeeping_tasks (reservation_id)
  WHERE reservation_id IS NOT NULL AND source = 'pre_arrival';

CREATE INDEX IF NOT EXISTS housekeeping_tasks_source_idx
  ON public.housekeeping_tasks (source);

CREATE INDEX IF NOT EXISTS housekeeping_tasks_booking_idx
  ON public.housekeeping_tasks (booking_id);
