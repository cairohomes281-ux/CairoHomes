-- All Outside Channel (Airbnb / Booking.com) stays are USD. Keep the same stored
-- amount number and use exchange_rate = 1 so nothing is converted. Rows that are
-- already USD with a custom rate are left alone.

UPDATE public.reservations
SET currency = 'USD',
    exchange_rate = 1,
    updated_at = now()
WHERE lower(trim(COALESCE(booking_source, ''))) IN (
    'outside channel',
    'airbnb',
    'booking.com',
    'booking',
    'bookingcom'
  )
  AND NOT (
    upper(COALESCE(currency, 'EGP')) = 'USD'
    AND exchange_rate IS NOT NULL
    AND exchange_rate <> 1
  );
