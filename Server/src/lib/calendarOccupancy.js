const { query } = require('../config/db');
const { isIcalOccupancySource } = require('./otaPlatforms');

/** Guest listing calendars must load at least this far; keep in sync with Client/src/constants/availability.js */
const GUEST_AVAILABILITY_MONTHS = 12;

const IMPLICIT_STAY_SOURCES = ['reservation', 'reservation_import', 'booking'];
const EXPLICIT_HOLD_SOURCES = [
  'manual',
  'owner',
  'ical',
  'csv_import',
  'ch_availability_xlsx',
];
/** Schedule/owner blocks stay closed on a checkout morning. iCal leftovers and unpriced nights do not. */
const SCHEDULE_HOLD_SOURCES = new Set(['manual', 'owner', 'csv_import', 'ch_availability_xlsx']);

const REQUIRED_OCCUPANCY_TABLES = [
  'unit_ical_blocks',
  'unit_blocked_dates',
  'reservations',
  'bookings',
];

function occupancySql({ wpScoped }) {
  const blockFilter = wpScoped ? 'AND b.wp_post_id = $3' : '';
  const unitFilter = wpScoped ? 'AND u.wp_post_id = $3' : '';
  return `
    SELECT u.id AS unit_id, b.wp_post_id, b.date::text AS date,
           ('ical:' || COALESCE(b.platform, f.platform, 'other')) AS source
    FROM unit_ical_blocks b
    JOIN unit_ota_feeds f ON f.id = b.feed_id
    JOIN units u ON u.wp_post_id = b.wp_post_id
    WHERE b.date >= $1 AND b.date < $2 ${blockFilter}
    UNION ALL
    SELECT u.id AS unit_id, b.wp_post_id, b.date::text AS date, COALESCE(b.source,'manual') AS source
    FROM unit_blocked_dates b
    JOIN units u ON u.wp_post_id = b.wp_post_id
    WHERE b.date >= $1 AND b.date < $2 ${blockFilter}
      AND COALESCE(b.source, 'manual') NOT IN ('reservation', 'reservation_import', 'booking')
    UNION ALL
    SELECT u.id AS unit_id, u.wp_post_id, d::text AS date, 'reservation' AS source
    FROM reservations r
    JOIN units u ON u.id = r.unit_id
    , generate_series(r.check_in, r.check_out - 1, interval '1 day') d
    WHERE r.status <> 'cancelled'
      AND d >= $1::date AND d < $2::date
      ${unitFilter}
    UNION ALL
    SELECT u.id AS unit_id, u.wp_post_id, d::text AS date, 'booking' AS source
    FROM bookings bk
    JOIN units u ON u.wp_post_id = bk.listing_wp_id
    , generate_series(bk.checkin, bk.checkout - 1, interval '1 day') d
    WHERE bk.status IN ('confirmed','pending','held')
      AND (bk.hold_expires_at IS NULL OR bk.hold_expires_at > now())
      AND d >= $1::date AND d < $2::date
      ${unitFilter}
  `;
}

function stayCheckoutSql({ wpScoped }) {
  const resFilter = wpScoped ? 'AND u.wp_post_id = $3' : '';
  const bookFilter = wpScoped ? 'AND b.listing_wp_id = $3' : '';
  return `
    SELECT d::text AS date FROM (
      SELECT r.check_out AS d
      FROM reservations r
      JOIN units u ON u.id = r.unit_id
      WHERE r.status <> 'cancelled'
        AND r.check_out >= $1::date AND r.check_out < $2::date
        ${resFilter}
      UNION
      SELECT b.checkout
      FROM bookings b
      WHERE b.status IN ('confirmed','pending','held')
        AND (b.hold_expires_at IS NULL OR b.hold_expires_at > now())
        AND b.checkout >= $1::date AND b.checkout < $2::date
        ${bookFilter}
    ) t
  `;
}

function mergeOccupancyByDate(rows, from, to) {
  const byDate = new Map();
  for (const row of rows || []) {
    const date = row?.date;
    if (!date || date < from || date >= to) continue;
    if (!byDate.has(date)) byDate.set(date, row.source || 'manual');
  }
  return byDate;
}

/**
 * Checkout morning is open for the next arrival unless that night is already
 * occupied by another stay, or closed by an explicit Schedule/owner hold.
 * Leftover unpriced nights and iCal DTEND-inclusive days must not block turnover —
 * those are why some units allowed same-day check-in and others did not.
 */
function applyCheckoutTurnover(byDate, checkoutDates) {
  const occupiedNights = new Set(
    [...byDate.entries()]
      .filter(([, source]) => source === 'reservation' || source === 'booking')
      .map(([date]) => date)
  );
  for (const date of checkoutDates || []) {
    if (!date || occupiedNights.has(date)) continue;
    const src = byDate.get(date);
    if (SCHEDULE_HOLD_SOURCES.has(src)) continue;
    byDate.delete(date);
  }
  return byDate;
}

function occupancyDates(byDate) {
  return [...byDate.keys()].sort();
}

/** Schedule overlay never includes unpriced; guest calendars may. */
function guestDatesMustIncludeSchedule(scheduleDates, guestBlockedRows) {
  const guest = new Set(
    (guestBlockedRows || [])
      .filter((row) => row.source !== 'unpriced')
      .map((row) => row.date)
  );
  return (scheduleDates || []).filter((date) => !guest.has(date));
}

async function fetchCalendarOccupancyRows({ from, to, wpPostId = null } = {}) {
  const wpScoped = wpPostId != null;
  const params = wpScoped ? [from, to, wpPostId] : [from, to];
  const { rows } = await query(occupancySql({ wpScoped }), params);
  return rows;
}

async function fetchStayCheckoutDates({ from, to, wpPostId = null } = {}) {
  const wpScoped = wpPostId != null;
  const params = wpScoped ? [from, to, wpPostId] : [from, to];
  const { rows } = await query(stayCheckoutSql({ wpScoped }), params);
  return rows.map((r) => r.date).filter(Boolean);
}

module.exports = {
  GUEST_AVAILABILITY_MONTHS,
  IMPLICIT_STAY_SOURCES,
  EXPLICIT_HOLD_SOURCES,
  SCHEDULE_HOLD_SOURCES,
  REQUIRED_OCCUPANCY_TABLES,
  isIcalOccupancySource,
  occupancySql,
  stayCheckoutSql,
  mergeOccupancyByDate,
  applyCheckoutTurnover,
  occupancyDates,
  guestDatesMustIncludeSchedule,
  fetchCalendarOccupancyRows,
  fetchStayCheckoutDates,
};
