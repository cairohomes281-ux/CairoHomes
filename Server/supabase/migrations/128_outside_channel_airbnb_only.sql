-- Airbnb and Booking.com already block each other, so Cairo Homes syncs one
-- Airbnb calendar. Stays from either channel are a single Outside Channel reservation.
-- Existing Airbnb amounts keep the same number and are labeled USD (no conversion).

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS ota_dates_locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reservations.ota_dates_locked IS
  'Staff confirmed the real check-in and check-out, so a later Airbnb sync must not stretch this stay back across the whole blocked span.';

UPDATE public.reservations
SET currency = 'USD',
    exchange_rate = 1,
    updated_at = now()
WHERE lower(trim(COALESCE(booking_source, ''))) = 'airbnb'
  AND NOT (
    upper(COALESCE(currency, 'EGP')) = 'USD'
    AND exchange_rate IS NOT NULL
    AND exchange_rate <> 1
  );

-- A Booking.com row that only repeats nights already on another stay is an echo.
UPDATE public.reservations b
SET status = 'cancelled',
    notes = btrim(COALESCE(b.notes, '') || ' Cancelled because these nights are already on the Airbnb calendar.'),
    updated_at = now()
WHERE lower(trim(COALESCE(b.booking_source, ''))) IN ('booking.com', 'booking')
  AND b.status IS DISTINCT FROM 'cancelled'
  AND b.ota_event_uid IS NOT NULL
  AND (
    COALESCE(b.total_amount, 0) <= 0
    OR NULLIF(btrim(COALESCE(b.guest_phone, '')), '') IS NULL
    OR lower(btrim(COALESCE(b.guest_name, ''))) IN ('booking.com guest', 'airbnb guest', 'outside channel guest', '')
  )
  AND EXISTS (
    SELECT 1 FROM public.reservations a
    WHERE a.unit_id = b.unit_id
      AND a.id <> b.id
      AND a.status IS DISTINCT FROM 'cancelled'
      AND a.check_in < b.check_out
      AND a.check_out > b.check_in
  );

UPDATE public.reservations
SET guest_name = 'Outside Channel guest',
    updated_at = now()
WHERE status IS DISTINCT FROM 'cancelled'
  AND lower(btrim(COALESCE(guest_name, ''))) IN ('airbnb guest', 'booking.com guest');

UPDATE public.reservations
SET booking_source = 'Outside Channel',
    updated_at = now()
WHERE lower(trim(COALESCE(booking_source, ''))) IN ('airbnb', 'booking.com', 'booking', 'bookingcom');

UPDATE public.units u
SET ical_url = f.ical_url,
    updated_at = now()
FROM public.unit_ota_feeds f
WHERE f.unit_id = u.id
  AND lower(f.platform) = 'airbnb'
  AND f.ical_url IS NOT NULL
  AND btrim(f.ical_url) <> '';

UPDATE public.listing_ical li
SET ical_url = f.ical_url,
    updated_at = now()
FROM public.unit_ota_feeds f
JOIN public.units u ON u.id = f.unit_id
WHERE li.wordpress_post_id = u.wp_post_id
  AND lower(f.platform) = 'airbnb'
  AND f.ical_url IS NOT NULL
  AND btrim(f.ical_url) <> '';

-- Drop a Booking.com night only when Airbnb or an existing stay already covers it,
-- so a home that is not on Airbnb yet does not suddenly open booked nights.
DELETE FROM public.unit_ical_blocks b
USING public.unit_ota_feeds f
WHERE b.feed_id = f.id
  AND lower(f.platform) = 'booking'
  AND (
    EXISTS (
      SELECT 1
      FROM public.unit_ical_blocks a
      JOIN public.unit_ota_feeds af ON af.id = a.feed_id
      WHERE af.unit_id = f.unit_id
        AND lower(af.platform) = 'airbnb'
        AND a.date = b.date
    )
    OR EXISTS (
      SELECT 1
      FROM public.reservations r
      JOIN public.units u ON u.id = r.unit_id
      WHERE u.wp_post_id = b.wp_post_id
        AND r.status IS DISTINCT FROM 'cancelled'
        AND b.date >= r.check_in
        AND b.date < r.check_out
    )
  );

ALTER TABLE public.unit_ota_feeds ALTER COLUMN ical_url DROP NOT NULL;

UPDATE public.unit_ota_feeds
SET enabled = false,
    ical_url = NULL,
    sync_status = 'disconnected',
    last_sync_error = NULL,
    updated_at = now()
WHERE lower(platform) = 'booking';
