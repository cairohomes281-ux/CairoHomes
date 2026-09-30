-- Guest ID photos uploaded at checkout (website bookings)

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS id_photo_urls text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS id_photo_urls text[] NOT NULL DEFAULT '{}';

-- Backfill from Paymob checkout session payloads when booking is linked
UPDATE public.bookings b
SET id_photo_urls = COALESCE(
  (
    SELECT ARRAY(
      SELECT jsonb_array_elements_text(ccs.payload->'photo_urls')
    )
    FROM public.card_checkout_sessions ccs
    WHERE ccs.booking_id = b.id
      AND jsonb_typeof(ccs.payload->'photo_urls') = 'array'
    LIMIT 1
  ),
  b.id_photo_urls
)
WHERE COALESCE(cardinality(b.id_photo_urls), 0) = 0;

UPDATE public.reservations r
SET id_photo_urls = b.id_photo_urls
FROM public.bookings b
WHERE r.booking_id = b.id
  AND COALESCE(cardinality(r.id_photo_urls), 0) = 0
  AND COALESCE(cardinality(b.id_photo_urls), 0) > 0;
