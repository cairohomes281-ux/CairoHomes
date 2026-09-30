const { query } = require('../config/db');

function todayIsoBusiness(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function toIsoDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function addMonthsIso(iso, months) {
  const start = toIsoDate(iso);
  if (!start) return null;
  const d = new Date(`${start}T00:00:00`);
  d.setMonth(d.getMonth() + Number(months || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Fill unit_daily_prices from a flat fallback price for [from, toExclusive).
 * Never overwrites an existing price > 0.
 */
async function seedFallbackDailyPrices({
  wpPostId,
  price,
  from,
  toExclusive,
  source = 'fallback-seed',
} = {}) {
  const wp = Number(wpPostId);
  const amount = Math.round(Number(price));
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(toExclusive);
  if (!Number.isFinite(wp) || wp <= 0) return { seeded: 0 };
  if (!(amount > 0) || !fromIso || !toIso || toIso <= fromIso) return { seeded: 0 };

  const { rowCount } = await query(
    `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
     SELECT $1::bigint, d::date, $2::int, 'EGP', $3, now()
     FROM generate_series($4::date, ($5::date - 1), '1 day'::interval) AS d
     WHERE NOT EXISTS (
       SELECT 1
       FROM unit_daily_prices p
       WHERE p.wp_post_id = $1::bigint
         AND p.date = d::date
         AND COALESCE(p.price, 0) > 0
     )
     ON CONFLICT (wp_post_id, date) DO UPDATE SET
       price = EXCLUDED.price,
       source = EXCLUDED.source,
       updated_at = now()
     WHERE COALESCE(unit_daily_prices.price, 0) <= 0`,
    [wp, amount, source, fromIso, toIso]
  );

  return { seeded: rowCount || 0, from: fromIso, toExclusive: toIso, price: amount };
}

/** Seed from start date through the next N months using the unit fallback price. */
async function seedUnitFallbackHorizon(unit, { from = null, months = 3, source = 'unit-create-fallback' } = {}) {
  if (!unit) return { seeded: 0 };
  if (String(unit.listing_type || 'rent').toLowerCase() !== 'rent') return { seeded: 0 };

  const price = Number(unit.price_fallback || unit.price_per_night);
  const wp = unit.wp_post_id;
  const start = toIsoDate(from) || todayIsoBusiness();
  const end = addMonthsIso(start, months);
  return seedFallbackDailyPrices({
    wpPostId: wp,
    price,
    from: start,
    toExclusive: end,
    source,
  });
}

module.exports = {
  toIsoDate,
  addMonthsIso,
  seedFallbackDailyPrices,
  seedUnitFallbackHorizon,
};
