const { query } = require('../../config/db');
const { GUEST_AVAILABILITY_MONTHS } = require('../calendarOccupancy');

function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function loadMappings(connectionId) {
  const { rows } = await query(
    `SELECT m.*, u.slug, u.title, u.wp_post_id, u.price_fallback, u.price_currency
     FROM channel_unit_mappings m
     JOIN units u ON u.id = m.unit_id
     WHERE m.connection_id = $1`,
    [connectionId]
  );
  return rows;
}

/**
 * Build open/closed inventory rows for mapped units over the guest horizon.
 */
async function buildAvailabilityPayload(connection, { monthsAhead = GUEST_AVAILABILITY_MONTHS } = {}) {
  const mappings = await loadMappings(connection.id);
  const today = new Date();
  const from = localIso(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const to = localIso(
    new Date(today.getFullYear(), today.getMonth() + monthsAhead, today.getDate())
  );

  const rooms = [];
  for (const map of mappings) {
    const { rows: blocked } = await query(
      `SELECT d::text AS date FROM (
         SELECT generate_series($2::date, $3::date - 1, interval '1 day') d
       ) s
       WHERE EXISTS (
         SELECT 1 FROM unit_blocked_dates b
         WHERE b.wp_post_id = $1 AND b.date = s.d::date
           AND COALESCE(b.source,'manual') NOT IN ('reservation','reservation_import','booking')
       )
       OR EXISTS (
         SELECT 1 FROM reservations r
         WHERE r.unit_id = $4 AND r.status <> 'cancelled'
           AND s.d::date >= r.check_in AND s.d::date < r.check_out
       )
       OR EXISTS (
         SELECT 1 FROM unit_ical_blocks ib
         WHERE ib.wp_post_id = $1 AND ib.date = s.d::date
       )`,
      [map.wp_post_id, from, to, map.unit_id]
    );
    const closed = new Set(blocked.map((r) => r.date));
    const days = [];
    for (let d = new Date(`${from}T00:00:00`); localIso(d) < to; d.setDate(d.getDate() + 1)) {
      const iso = localIso(d);
      days.push({ date: iso, available: !closed.has(iso) });
    }
    rooms.push({
      unit_id: map.unit_id,
      external_listing_id: map.external_listing_id,
      external_room_type_id: map.external_room_type_id,
      days,
    });
  }
  return { from, to, rooms };
}

async function buildRatesPayload(connection, { monthsAhead = GUEST_AVAILABILITY_MONTHS } = {}) {
  const mappings = await loadMappings(connection.id);
  const today = new Date();
  const from = localIso(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const to = localIso(
    new Date(today.getFullYear(), today.getMonth() + monthsAhead, today.getDate())
  );

  const rooms = [];
  for (const map of mappings) {
    const { rows: prices } = await query(
      `SELECT date::text AS date, price::float AS price
       FROM unit_daily_prices
       WHERE wp_post_id = $1 AND date >= $2::date AND date < $3::date
       ORDER BY date`,
      [map.wp_post_id, from, to]
    );
    const byDate = new Map(prices.map((p) => [p.date, p.price]));
    const fallback = Number(map.price_fallback) || null;
    const days = [];
    for (let d = new Date(`${from}T00:00:00`); localIso(d) < to; d.setDate(d.getDate() + 1)) {
      const iso = localIso(d);
      const price = byDate.has(iso) ? byDate.get(iso) : fallback;
      if (price != null && price > 0) {
        days.push({
          date: iso,
          price,
          currency: map.price_currency || 'EGP',
          rate_plan_id: map.external_rate_plan_id || null,
        });
      }
    }
    rooms.push({
      unit_id: map.unit_id,
      external_listing_id: map.external_listing_id,
      external_room_type_id: map.external_room_type_id,
      external_rate_plan_id: map.external_rate_plan_id,
      days,
    });
  }
  return { from, to, rooms };
}

module.exports = {
  loadMappings,
  buildAvailabilityPayload,
  buildRatesPayload,
};
