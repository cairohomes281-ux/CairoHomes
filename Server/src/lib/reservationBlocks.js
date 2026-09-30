const { query } = require('../config/db');
const { eachNight } = require('../services/pricing');

async function wpPostIdForUnit(unitId) {
  if (!unitId) return null;
  const { rows } = await query(`SELECT wp_post_id FROM units WHERE id = $1`, [unitId]);
  return rows[0]?.wp_post_id ?? null;
}

/** Block stay nights: check_in inclusive .. check_out exclusive (checkout day free for next guest). */
async function upsertReservationBlocks(wpPostId, checkIn, checkOut) {
  if (!wpPostId || !checkIn || !checkOut) return 0;
  let n = 0;
  for (const date of eachNight(checkIn, checkOut)) {
    await query(
      `INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
       VALUES ($1, $2::date, 'reservation', now())
       ON CONFLICT (wp_post_id, date) DO UPDATE
         SET source = CASE
               WHEN unit_blocked_dates.source IN ('manual', 'owner', 'ical')
                 THEN unit_blocked_dates.source
               ELSE 'reservation'
             END,
             updated_at = now()`,
      [wpPostId, date]
    );
    n += 1;
  }
  return n;
}

/**
 * Drop reservation-sourced blocks in a range that no longer belong to any
 * active (non-cancelled) reservation.
 */
async function releaseReservationBlocks(wpPostId, checkIn, checkOut) {
  if (!wpPostId || !checkIn || !checkOut) return 0;
  const { rowCount } = await query(
    `DELETE FROM unit_blocked_dates b
     WHERE b.wp_post_id = $1
       AND b.date >= $2::date
       AND b.date <= $3::date
       AND COALESCE(b.source, '') IN ('reservation', 'reservation_import', 'booking')
       AND NOT EXISTS (
         SELECT 1
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         WHERE u.wp_post_id = b.wp_post_id
           AND r.status IS DISTINCT FROM 'cancelled'
           AND b.date >= r.check_in
           AND b.date < r.check_out
       )`,
    [wpPostId, checkIn, checkOut]
  );
  return rowCount || 0;
}

async function syncBlocksForReservation(reservation) {
  if (!reservation) return;
  const wp = await wpPostIdForUnit(reservation.unit_id);
  if (!wp) return;
  const cancelled = String(reservation.status || '').toLowerCase() === 'cancelled';
  if (cancelled) {
    await releaseReservationBlocks(wp, reservation.check_in, reservation.check_out);
  } else {
    await upsertReservationBlocks(wp, reservation.check_in, reservation.check_out);
  }
}

/**
 * After a date/unit change: release the old stay nights, then sync the new row.
 */
async function resyncReservationBlocks(previous, next) {
  if (previous?.unit_id && previous?.check_in && previous?.check_out) {
    const oldWp = await wpPostIdForUnit(previous.unit_id);
    await releaseReservationBlocks(oldWp, previous.check_in, previous.check_out);
  }
  await syncBlocksForReservation(next);
}

/**
 * Drop reservation-sourced calendar blocks that are not an occupied stay night
 * (typical leftover: checkout day written inclusively).
 */
async function purgeStaleReservationBlocks() {
  const { rowCount } = await query(`
    DELETE FROM unit_blocked_dates b
    WHERE COALESCE(b.source, '') IN ('reservation', 'reservation_import', 'booking')
      AND NOT EXISTS (
        SELECT 1
        FROM reservations r
        JOIN units u ON u.id = r.unit_id
        WHERE u.wp_post_id = b.wp_post_id
          AND r.status IS DISTINCT FROM 'cancelled'
          AND b.date >= r.check_in
          AND b.date < r.check_out
      )
      AND NOT EXISTS (
        SELECT 1
        FROM bookings bk
        JOIN units u ON u.wp_post_id = bk.listing_wp_id OR u.id = bk.unit_id
        WHERE u.wp_post_id = b.wp_post_id
          AND bk.status IN ('confirmed', 'pending', 'held')
          AND (bk.hold_expires_at IS NULL OR bk.hold_expires_at > now())
          AND b.date >= bk.checkin
          AND b.date < bk.checkout
      )
  `);
  return rowCount || 0;
}

/** Backfill every active reservation into unit_blocked_dates. */
async function syncAllActiveReservationBlocks() {
  const inserted = await query(`
    WITH nights AS (
      SELECT DISTINCT u.wp_post_id, d::date AS night
      FROM reservations r
      JOIN units u ON u.id = r.unit_id
      , generate_series(r.check_in, r.check_out - 1, interval '1 day') d
      WHERE r.status IS DISTINCT FROM 'cancelled'
        AND u.wp_post_id IS NOT NULL
    )
    INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
    SELECT n.wp_post_id, n.night, 'reservation', now()
    FROM nights n
    LEFT JOIN unit_blocked_dates b
      ON b.wp_post_id = n.wp_post_id AND b.date = n.night
    WHERE b.date IS NULL
    ON CONFLICT (wp_post_id, date) DO NOTHING
    RETURNING 1
  `);
  const purged = await purgeStaleReservationBlocks();
  return { inserted: inserted.rowCount || 0, purged };
}

module.exports = {
  wpPostIdForUnit,
  upsertReservationBlocks,
  releaseReservationBlocks,
  syncBlocksForReservation,
  resyncReservationBlocks,
  purgeStaleReservationBlocks,
  syncAllActiveReservationBlocks,
};
