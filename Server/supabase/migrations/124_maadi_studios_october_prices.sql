-- October 2026 nightly prices for the Maadi studios, given in USD and converted at the
-- CBE rate of 52.3902 EGP/USD (7 Oct 2026), rounded up to the next 100 EGP.
-- The October price also becomes each unit's base nightly price.
WITH prices (unit_number, egp) AS (
  VALUES
    ('MAAD-ST-1', 5300),
    ('MAAD-ST-2', 2900),
    ('MAAD-ST-3', 3200),
    ('MAAD-ST-4', 2500),
    ('MAAD-ST-5', 2500)
),
base AS (
  UPDATE public.units u
  SET price_fallback = p.egp, updated_at = now()
  FROM prices p
  WHERE upper(u.unit_number) = p.unit_number
  RETURNING u.wp_post_id, p.egp
)
INSERT INTO public.unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
SELECT b.wp_post_id, d::date, b.egp, 'EGP', 'manual-admin', now()
FROM base b
CROSS JOIN generate_series('2026-10-01'::date, '2026-10-31'::date, interval '1 day') AS d
WHERE b.wp_post_id IS NOT NULL
ON CONFLICT (wp_post_id, date) DO UPDATE SET
  price = EXCLUDED.price,
  currency = EXCLUDED.currency,
  source = EXCLUDED.source,
  updated_at = now();
