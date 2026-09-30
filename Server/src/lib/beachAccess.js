const { query } = require('../config/db');

const STAY_TIERS = [
  { maxNights: 3, adult: 1900, extra: 2500, days: 3 },
  { maxNights: 4, adult: 2500, extra: 3100, days: 4 },
  { maxNights: Infinity, adult: 3500, extra: 4100, days: 7 },
];

function projectNameCandidates(unit = {}) {
  return [
    ...new Set(
      [unit.project, unit.projectName, unit.project_name, unit.compound]
        .map((v) => String(v || '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

function isStudioUnit(unit = {}) {
  const type = String(unit.property_type || unit.type || '').trim().toLowerCase();
  if (type.includes('studio')) return true;
  const beds = Number(unit.beds ?? unit.bedrooms);
  if (Number.isFinite(beds) && beds <= 0) return true;
  return false;
}

function policyFromRow(row) {
  if (!row) {
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

function normalizeIncomingPolicy(body = {}) {
  const enabled =
    body.beach_access_enabled === true ||
    body.beach_access_enabled === 'true' ||
    body.beach_access_enabled === '1' ||
    body.beach_access_enabled === 1;

  if (!enabled) {
    return {
      beach_access_enabled: false,
      beach_access_mode: 'none',
      beach_access_adult_egp: null,
      beach_access_extra_egp: null,
      beach_access_days: null,
      beach_access_flat_egp: null,
      beach_access_flat_studio_egp: null,
    };
  }

  let mode = String(body.beach_access_mode || 'per_guest').trim().toLowerCase();
  if (!['per_guest', 'flat', 'free', 'tiered'].includes(mode)) mode = 'per_guest';

  const num = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    beach_access_enabled: true,
    beach_access_mode: mode,
    beach_access_adult_egp: mode === 'per_guest' ? num(body.beach_access_adult_egp ?? body.beach_access_price) : null,
    beach_access_extra_egp: mode === 'per_guest' ? num(body.beach_access_extra_egp ?? body.beach_access_extra_guest) : null,
    beach_access_days: num(body.beach_access_days) || 7,
    beach_access_flat_egp: mode === 'flat' ? num(body.beach_access_flat_egp ?? body.beach_access_adult_egp) : null,
    beach_access_flat_studio_egp:
      mode === 'flat' ? num(body.beach_access_flat_studio_egp) : null,
  };
}

async function lookupProjectBeachAccess({ project, compound } = {}) {
  const candidates = projectNameCandidates({ project, compound });
  if (!candidates.length) return policyFromRow(null);

  try {
    const { rows } = await query(
      `SELECT beach_access_enabled, beach_access_mode,
              beach_access_adult_egp, beach_access_extra_egp, beach_access_days,
              beach_access_flat_egp, beach_access_flat_studio_egp,
              normalized_name
       FROM location_projects
       WHERE normalized_name = ANY($1::text[])
       ORDER BY CASE WHEN normalized_name = $2 THEN 0 ELSE 1 END, id ASC
       LIMIT 1`,
      [candidates, candidates[0]]
    );
    return policyFromRow(rows[0]);
  } catch (err) {
    if (/beach_access_/i.test(err.message)) return policyFromRow(null);
    throw err;
  }
}

async function withBeachPolicy(unit) {
  if (!unit) return unit;
  if (unit.beach_policy && typeof unit.beach_policy === 'object') return unit;
  const policy = await lookupProjectBeachAccess({
    project: unit.project || unit.compound,
    compound: unit.compound,
  });
  return { ...unit, beach_policy: policy };
}

async function enrichUnitsWithBeachPolicy(units) {
  const list = Array.isArray(units) ? units : [];
  if (!list.length) return list;
  const names = [
    ...new Set(list.flatMap((u) => projectNameCandidates(u))),
  ];
  let map = new Map();
  if (names.length) {
    try {
      const { rows } = await query(
        `SELECT normalized_name, beach_access_enabled, beach_access_mode,
                beach_access_adult_egp, beach_access_extra_egp, beach_access_days,
                beach_access_flat_egp, beach_access_flat_studio_egp
         FROM location_projects
         WHERE normalized_name = ANY($1::text[])`,
        [names]
      );
      for (const row of rows) map.set(row.normalized_name, policyFromRow(row));
    } catch (err) {
      if (!/beach_access_/i.test(err.message)) throw err;
    }
  }
  return list.map((u) => {
    const candidates = projectNameCandidates(u);
    let policy = policyFromRow(null);
    for (const c of candidates) {
      if (map.has(c)) {
        policy = map.get(c);
        break;
      }
    }
    return { ...u, beach_policy: policy };
  });
}

/** Units no longer carry beach policy — always false. */
function beachAccessRequiresManualEntry() {
  return false;
}

function resolveBeachAccessRates(unit = {}, nights = 0) {
  const policy = unit.beach_policy || policyFromRow(null);

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

  // per_guest
  return {
    adult: Number(policy.adult) || 0,
    extra: Number(policy.extra) || 0,
    days: Number(policy.days) || 7,
    mode: 'per_guest',
    billing: 'per_guest',
  };
}

function computeBeachAccessFeeSync(unit = {}, { nights = 0, adults = 1, teens = 0 } = {}) {
  const beach = resolveBeachAccessRates(unit, nights);
  if (beach.billing === 'flat' || beach.mode === 'free' || beach.mode === 'none') {
    const fee = Number(beach.flat != null ? beach.flat : beach.adult) || 0;
    return { fee, beach };
  }
  const accessAdult = Number(beach.adult || 0) * Math.max(0, Number(adults) || 0);
  const accessTeen = Number(beach.extra || 0) * Math.max(0, Number(teens) || 0);
  return { fee: accessAdult + accessTeen, beach };
}

async function computeBeachAccessFee(unit = {}, opts = {}) {
  const enriched = await withBeachPolicy(unit);
  return computeBeachAccessFeeSync(enriched, opts);
}

/** Stop writing beach rates onto units. */
function beachAccessPersistValues() {
  return { adult: null, extra: null, days: null };
}

module.exports = {
  isStudioUnit,
  policyFromRow,
  normalizeIncomingPolicy,
  lookupProjectBeachAccess,
  withBeachPolicy,
  enrichUnitsWithBeachPolicy,
  beachAccessRequiresManualEntry,
  resolveBeachAccessRates,
  computeBeachAccessFee,
  computeBeachAccessFeeSync,
  beachAccessPersistValues,
  STAY_TIERS,
};
