-- Fill missing nightly prices through 31 Oct 2027 from each unit's existing
-- base price (price_fallback, or the latest priced night). Never overwrite a
-- price that is already > 0. Reservations and Airbnb blocks stay closed.
-- Also drop any leftover Booking.com iCal nights.

WITH priced_units AS (
  SELECT
    u.wp_post_id,
    ROUND(
      COALESCE(
        NULLIF(u.price_fallback, 0),
        (
          SELECT p.price
          FROM public.unit_daily_prices p
          WHERE p.wp_post_id = u.wp_post_id
            AND COALESCE(p.price, 0) > 0
          ORDER BY p.date DESC
          LIMIT 1
        )
      )
    )::int AS egp
  FROM public.units u
  WHERE u.wp_post_id IS NOT NULL
    AND COALESCE(u.listing_type, 'rent') = 'rent'
),
ready AS (
  SELECT wp_post_id, egp
  FROM priced_units
  WHERE egp > 0
)
INSERT INTO public.unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
SELECT r.wp_post_id, d::date, r.egp, 'EGP', 'fallback-seed-through-2027-10', now()
FROM ready r
CROSS JOIN generate_series(CURRENT_DATE, '2027-10-31'::date, interval '1 day') AS d
WHERE NOT EXISTS (
  SELECT 1
  FROM public.unit_daily_prices p
  WHERE p.wp_post_id = r.wp_post_id
    AND p.date = d::date
    AND COALESCE(p.price, 0) > 0
)
ON CONFLICT (wp_post_id, date) DO UPDATE SET
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  source = EXCLUDED.source,
  updated_at = now()
WHERE COALESCE(unit_daily_prices.price, 0) <= 0;

DELETE FROM public.unit_ical_blocks b
USING public.unit_ota_feeds f
WHERE b.feed_id = f.id
  AND lower(f.platform) = 'booking';
