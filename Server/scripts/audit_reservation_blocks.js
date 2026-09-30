/* Sync all active reservation nights into unit_blocked_dates + audit.
 * Night model: check_in .. check_out-1 (checkout day free for next arrival)
 * Usage: node scripts/audit_reservation_blocks.js [--fix]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool, query } = require('../src/config/db');
const { syncAllActiveReservationBlocks } = require('../src/lib/reservationBlocks');

const FIX = process.argv.includes('--fix');

async function main() {
  const summary = (
    await query(`
    SELECT
      count(*) FILTER (WHERE status <> 'cancelled') AS active,
      count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
      count(*) AS total
    FROM reservations
  `)
  ).rows[0];
  console.log('[summary] reservations', summary);

  const missingNightCount = (
    await query(`
    WITH nights AS (
      SELECT u.wp_post_id, d::date AS night
      FROM reservations r
      JOIN units u ON u.id = r.unit_id
      , generate_series(r.check_in, r.check_out - 1, interval '1 day') d
      WHERE r.status <> 'cancelled' AND u.wp_post_id IS NOT NULL
    )
    SELECT count(*)::int AS missing_nights
    FROM nights n
    LEFT JOIN unit_blocked_dates b
      ON b.wp_post_id = n.wp_post_id AND b.date = n.night
    WHERE b.date IS NULL
  `)
  ).rows[0];
  console.log('[missing_block_nights]', missingNightCount.missing_nights);

  const overlaps = (
    await query(`
    SELECT a.id AS a_id, b.id AS b_id, u.unit_number,
           a.guest_name AS a_guest, a.check_in::text AS a_in, a.check_out::text AS a_out,
           b.guest_name AS b_guest, b.check_in::text AS b_in, b.check_out::text AS b_out
    FROM reservations a
    JOIN reservations b ON a.unit_id = b.unit_id AND a.id < b.id
    JOIN units u ON u.id = a.unit_id
    WHERE a.status <> 'cancelled' AND b.status <> 'cancelled'
      AND a.check_in < b.check_out AND b.check_in < a.check_out
    ORDER BY u.unit_number, a.check_in
  `)
  ).rows;
  console.log('[overlapping_active_reservations]', overlaps.length);
  for (const r of overlaps) console.log(' ', r);

  if (!FIX) {
    console.log('\nRe-run with --fix to sync missing reservation nights into unit_blocked_dates.');
    return;
  }

  const result = await syncAllActiveReservationBlocks();
  const inserted = typeof result === 'number' ? result : result?.inserted || 0;
  const purged = typeof result === 'object' ? result?.purged || 0 : 0;
  console.log(`[fix] inserted_missing_nights=${inserted} purged_stale_checkout_blocks=${purged}`);

  const after = (
    await query(`
    WITH nights AS (
      SELECT u.wp_post_id, d::date AS night
      FROM reservations r
      JOIN units u ON u.id = r.unit_id
      , generate_series(r.check_in, r.check_out - 1, interval '1 day') d
      WHERE r.status <> 'cancelled' AND u.wp_post_id IS NOT NULL
    )
    SELECT count(*)::int AS missing_nights
    FROM nights n
    LEFT JOIN unit_blocked_dates b
      ON b.wp_post_id = n.wp_post_id AND b.date = n.night
    WHERE b.date IS NULL
  `)
  ).rows[0];
  console.log('[after] missing_block_nights', after.missing_nights);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (_) {}
  });
