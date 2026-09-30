const DEFAULT_MIN_STAY_NIGHTS = 2;

export function getMinimumStayNights(unit) {
  const n = parseInt(unit?.min_nights, 10);
  if (Number.isFinite(n) && n >= 1) return n;
  return DEFAULT_MIN_STAY_NIGHTS;
}

export { DEFAULT_MIN_STAY_NIGHTS };
