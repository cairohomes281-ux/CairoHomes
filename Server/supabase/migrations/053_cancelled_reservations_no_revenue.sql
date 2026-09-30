-- Cancelled reservations must not contribute money or open balances.
-- Keep the row (shown in red) but clear paid amounts and linked money rows.
-- payment_status check only allows pending | partial | paid.

UPDATE public.reservations
SET amount_paid = 0,
    payment_status = 'pending',
    updated_at = now()
WHERE status = 'cancelled'
  AND COALESCE(amount_paid, 0) <> 0;

DELETE FROM public.payments p
USING public.reservations r
WHERE p.reservation_id = r.id
  AND r.status = 'cancelled';

DELETE FROM public.commissions c
USING public.reservations r
WHERE c.reservation_id = r.id
  AND r.status = 'cancelled';
