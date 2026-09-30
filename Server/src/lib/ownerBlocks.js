const { query } = require('../config/db');
const { calcReservationFinancials, round2 } = require('./commission');

function eachDate(from, toExclusive) {
  const out = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${toExclusive}T00:00:00`);
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

async function ensureWpPostId(unitId) {
  const { rows } = await query(`SELECT id, wp_post_id FROM units WHERE id = $1`, [unitId]);
  if (!rows[0]) return null;
  if (rows[0].wp_post_id != null) return rows[0].wp_post_id;
  const { rows: maxRows } = await query(
    `SELECT COALESCE(MAX(wp_post_id), 900000) + 1 AS next FROM units`
  );
  const next = Number(maxRows[0].next);
  await query(`UPDATE units SET wp_post_id = $1, updated_at = now() WHERE id = $2`, [
    next,
    unitId,
  ]);
  return next;
}


async function previewOwnerBlockImpact(unitId, fromDate, toDate) {
  const { rows: units } = await query(`SELECT * FROM units WHERE id = $1`, [unitId]);
  const unit = units[0];
  if (!unit) throw Object.assign(new Error('Unit not found'), { status: 404 });

  const nights = eachDate(fromDate, toDate);
  if (!nights.length) {
    return {
      unit_id: unitId,
      from_date: fromDate,
      to_date: toDate,
      nights: 0,
      conflicts: [],
      estimated_gross: 0,
      estimated_commission: 0,
      estimated_owner_net_forgone: 0,
      price_basis: 'none',
    };
  }

  
  const { rows: conflicts } = await query(
    `SELECT id, check_in::text AS check_in, check_out::text AS check_out, status,
            CASE WHEN is_owner_reservation = 1 THEN 'owner_stay' ELSE 'guest_booking' END AS kind
     FROM reservations
     WHERE unit_id = $1
       AND status <> 'cancelled'
       AND check_in < $3::date
       AND check_out > $2::date`,
    [unitId, fromDate, toDate]
  );

  const wp = unit.wp_post_id;
  let gross = 0;
  let pricedNights = 0;
  let priceBasis = 'fallback';

  if (wp != null) {
    const { rows: prices } = await query(
      `SELECT date::text AS date, price FROM unit_daily_prices
       WHERE wp_post_id = $1 AND date >= $2::date AND date < $3::date`,
      [wp, fromDate, toDate]
    );
    const map = Object.fromEntries(prices.map((p) => [p.date, Number(p.price)]));
    const fallback = Number(unit.price_fallback) || 0;
    for (const d of nights) {
      if (map[d] > 0) {
        gross += map[d];
        pricedNights += 1;
        priceBasis = 'daily_prices';
      } else if (fallback > 0) {
        gross += fallback;
        pricedNights += 1;
      }
    }
    if (pricedNights && pricedNights < nights.length && fallback > 0) priceBasis = 'mixed';
  } else {
    const fallback = Number(unit.price_fallback) || 0;
    gross = fallback * nights.length;
    pricedNights = fallback > 0 ? nights.length : 0;
  }

  const fakeRes = {
    nights: nights.length,
    total_amount: gross,
    price_per_night: nights.length ? gross / nights.length : 0,
    housekeeping_fees: 0,
    utilities_amount: 0,
    is_owner_reservation: 0,
  };
  const fin = calcReservationFinancials(unit, fakeRes);

  return {
    unit_id: unitId,
    unit_name: unit.unit_number || unit.title,
    from_date: fromDate,
    to_date: toDate,
    nights: nights.length,
    dates: nights,
    conflicts,
    has_conflicts: conflicts.length > 0,
    estimated_gross: round2(gross),
    estimated_commission: fin.companyCommission,
    estimated_owner_net_forgone: fin.ownerNet,
    price_basis: priceBasis,
    priced_nights: pricedNights,
  };
}

async function applyOwnerBlocks(unitId, fromDate, toDate, { clear = false } = {}) {
  const wp = await ensureWpPostId(unitId);
  if (wp == null) throw Object.assign(new Error('Unit not found'), { status: 404 });

  if (clear) {
    const { rowCount } = await query(
      `DELETE FROM unit_blocked_dates
       WHERE wp_post_id = $1 AND date >= $2::date AND date < $3::date AND source IN ('manual','owner')`,
      [wp, fromDate, toDate]
    );
    return { cleared: rowCount };
  }

  const nights = eachDate(fromDate, toDate);
  let n = 0;
  for (const date of nights) {
    await query(
      `INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
       VALUES ($1,$2,'owner',now())
       ON CONFLICT (wp_post_id, date) DO UPDATE SET source = 'owner', updated_at = now()`,
      [wp, date]
    );
    n += 1;
  }
  return { count: n, wp_post_id: wp };
}

module.exports = {
  eachDate,
  ensureWpPostId,
  previewOwnerBlockImpact,
  applyOwnerBlocks,
};
