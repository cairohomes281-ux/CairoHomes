const STAY_TIERS = [
  { maxNights: 3, adult: 1900, extra: 2500, days: 3 },
  { maxNights: 4, adult: 2500, extra: 3100, days: 4 },
  { maxNights: Infinity, adult: 3500, extra: 4100, days: 7 },
];

export function isStudioUnit(unit = {}) {
  const type = String(unit.property_type || unit.type || '').trim().toLowerCase();
  if (type.includes('studio')) return true;
  const beds = Number(unit.beds ?? unit.bedrooms);
  if (Number.isFinite(beds) && beds <= 0) return true;
  return false;
}

function emptyPolicy() {
  return {
    enabled: false,
    mode: 'none',
    adult: 0,
    extra: 0,
    days: 7,
    flat: 0,
    flat_studio: 0,
  };
}

export function policyFromProjectRow(row) {
  if (!row) return emptyPolicy();
  const enabled = Boolean(row.beach_access_enabled);
  const mode = enabled ? String(row.beach_access_mode || 'per_guest') : 'none';
  return {
    enabled,
    mode: mode === 'none' && enabled ? 'per_guest' : mode,
    adult: Number(row.beach_access_adult_egp) || 0,
    extra: Number(row.beach_access_extra_egp) || 0,
    days: Number(row.beach_access_days) || 7,
    flat: Number(row.beach_access_flat_egp) || 0,
    flat_studio: Number(row.beach_access_flat_studio_egp) || 0,
  };
}

/** Units no longer configure beach access. */
export function beachAccessRequiresManualEntry() {
  return false;
}

export function resolveBeachAccessRates(unit = {}, nights = 0) {
  const policy = unit.beach_policy || emptyPolicy();

  if (!policy.enabled || policy.mode === 'none') {
    return { adult: 0, extra: 0, days: 7, mode: 'none', billing: 'flat', flat: 0 };
  }

  if (policy.mode === 'free') {
    return { adult: 0, extra: 0, days: policy.days || 7, mode: 'free', billing: 'flat', flat: 0 };
  }

  if (policy.mode === 'flat') {
    const flat = isStudioUnit(unit)
      ? Number(policy.flat_studio || policy.flat) || 0
      : Number(policy.flat || policy.adult) || 0;
    return {
      adult: flat,
      extra: 0,
      days: policy.days || 7,
      mode: 'flat',
      billing: 'flat',
      flat,
    };
  }

  if (policy.mode === 'tiered') {
    const n = Math.max(0, Number(nights) || 0);
    const tier = STAY_TIERS.find((t) => n <= t.maxNights) || STAY_TIERS[STAY_TIERS.length - 1];
    return {
      adult: tier.adult,
      extra: tier.extra,
      days: tier.days,
      mode: 'tiered',
      billing: 'per_guest',
    };
  }

  return {
    adult: Number(policy.adult) || 0,
    extra: Number(policy.extra) || 0,
    days: Number(policy.days) || 7,
    mode: 'per_guest',
    billing: 'per_guest',
  };
}

export function getGuestLoad(adults, children) {
  return Number(adults || 0) + Number(children || 0) * 0.5;
}

export function computeBeachAccessFee(unit = {}, { nights = 0, adults = 1, teens = 0 } = {}) {
  const beach = resolveBeachAccessRates(unit, nights);
  if (beach.billing === 'flat' || beach.mode === 'free' || beach.mode === 'none') {
    const fee = Number(beach.flat != null ? beach.flat : beach.adult) || 0;
    return { fee, beach };
  }
  const accessAdult = Number(beach.adult || 0) * Math.max(0, Number(adults) || 0);
  const accessTeen = Number(beach.extra || 0) * Math.max(0, Number(teens) || 0);
  return { fee: accessAdult + accessTeen, beach };
}

/** @deprecated Unit forms no longer set beach defaults from project name. */
export function beachAccessFormDefaults() {
  return null;
}

export { STAY_TIERS };
