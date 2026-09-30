/**
 * Reconcile website booking payment breakdown lines with booking.total_egp.
 * Line items come from a fresh quote (pre-promo); total_egp on the booking is post-promo.
 */
export function resolveWebsiteBookingPayTotals(pay = {}, booking = {}) {
  const lineSum = ['subtotal', 'housekeeping_fees', 'beach_access_fees', 'service_fees'].reduce(
    (sum, key) => sum + (Number(pay[key]) || 0),
    0
  );
  const hasLines = pay.subtotal != null && lineSum > 0;
  const bookedTotal = Number(booking?.total_egp) || 0;
  const paid = Number(pay.amount_paid ?? booking?.amount_paid) || 0;

  let beforePromo = hasLines ? lineSum : Number(pay.amount_before_promo) || 0;
  let promo = Number(pay.promo_discount) || 0;
  let total = bookedTotal > 0 ? bookedTotal : Number(pay.total_egp) || 0;

  if (hasLines && bookedTotal > 0) {
    beforePromo = lineSum;
    if (pay.promo_code || promo > 0 || bookedTotal < lineSum - 0.5) {
      promo = Math.max(0, Math.round((lineSum - bookedTotal) * 100) / 100);
    }
    total = bookedTotal;
  } else if (hasLines && promo > 0) {
    beforePromo = lineSum;
    total = Math.max(0, Math.round((lineSum - promo) * 100) / 100);
  } else if (hasLines && !total) {
    total = lineSum;
    beforePromo = lineSum;
  }

  const due = Math.max(0, Math.round((total - paid) * 100) / 100);

  return {
    ...pay,
    amount_before_promo: beforePromo > 0 ? beforePromo : null,
    promo_discount: promo > 0 ? promo : null,
    total_egp: total,
    amount_paid: paid,
    amount_due: due,
  };
}
