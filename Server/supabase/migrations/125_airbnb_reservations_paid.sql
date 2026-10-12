-- Airbnb stays are collected on Airbnb, so they are already paid here.
UPDATE public.reservations
SET amount_paid = COALESCE(total_amount, 0),
    payment_status = 'paid',
    status = CASE
      WHEN lower(status) IN ('pending', 'hold') THEN 'confirmed'
      ELSE status
    END,
    updated_at = now()
WHERE lower(trim(COALESCE(booking_source, ''))) = 'airbnb'
  AND status IS DISTINCT FROM 'cancelled'
  AND (
    lower(COALESCE(payment_status, '')) IS DISTINCT FROM 'paid'
    OR COALESCE(amount_paid, 0) + 0.5 < COALESCE(total_amount, 0)
    OR lower(status) IN ('pending', 'hold')
  );
