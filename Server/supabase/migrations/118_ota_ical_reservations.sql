-- Reservations created automatically from Airbnb / Booking.com iCal events.
-- iCal carries only dates (plus a reservation code and phone last-4 for Airbnb), so these
-- rows start as placeholders that staff complete with the guest name, phone and amount.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS ota_feed_id uuid REFERENCES public.unit_ota_feeds(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ota_event_uid text,
  ADD COLUMN IF NOT EXISTS ota_reservation_code text,
  ADD COLUMN IF NOT EXISTS ota_phone_last4 text,
  ADD COLUMN IF NOT EXISTS ota_removed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_ota_event_uniq
  ON public.reservations (ota_feed_id, ota_event_uid)
  WHERE ota_feed_id IS NOT NULL AND ota_event_uid IS NOT NULL;

COMMENT ON COLUMN public.reservations.ota_event_uid IS
  'UID of the Airbnb / Booking.com iCal event this reservation was imported from';
