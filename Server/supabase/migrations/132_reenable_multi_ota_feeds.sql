-- Re-enable multi-OTA iCal sync (Airbnb + Booking.com + other linked feeds).
-- Migration 128 cleared Booking.com URLs; staff must paste each channel export
-- link again in Calendar Sync. This only restores the ability to enable feeds.

UPDATE public.unit_ota_feeds
SET sync_status = CASE
      WHEN ical_url IS NOT NULL AND btrim(ical_url) <> '' THEN COALESCE(sync_status, 'disconnected')
      ELSE 'disconnected'
    END,
    updated_at = now()
WHERE lower(platform) IN ('booking', 'travigo', 'other', 'airbnb');

COMMENT ON TABLE public.unit_ota_feeds IS
  'Per-unit OTA iCal feeds (Airbnb, Booking.com, Travigo, other). All enabled feeds with a URL sync every minute.';
