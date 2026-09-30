
/** Guest-facing price: per night for short-term units, per month for long-term units. */
export function getDisplayPriceEgp(unitOrListing) {
  const longTerm = String(unitOrListing?.listing_type || '').toLowerCase() === 'long_term';
  const amount = Number(
    longTerm
      ? unitOrListing?.price_monthly ?? 0
      : unitOrListing?.from_price ??
          unitOrListing?.price_fallback ??
          unitOrListing?.price_per_night ??
          0
  );
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
