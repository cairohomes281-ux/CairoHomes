
const { pool } = require('../config/db');

async function awardPointsForBooking(booking, { reason = 'reservation' } = {}) {
  if (!booking?.id) return null;
  const email = String(booking.guest_email || '').trim().toLowerCase();
  if (!email) return null;

  const points = Math.max(0, Math.round(Number(booking.total_egp) || 0));
  if (points <= 0) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: profiles } = await client.query(
      `SELECT id, home_points FROM profiles WHERE lower(email) = $1 LIMIT 1`,
      [email]
    );
    const profile = profiles[0];
    if (!profile) {
      await client.query('ROLLBACK');
      return null;
    }

    const existing = await client.query(
      `SELECT id FROM home_points_ledger
       WHERE booking_id = $1 AND points > 0
       LIMIT 1`,
      [booking.id]
    );
    if (existing.rows[0]) {
      await client.query('COMMIT');
      return { awarded: false, reason: 'already_awarded' };
    }

    await client.query(
      `INSERT INTO home_points_ledger (profile_id, booking_id, points, reason)
       VALUES ($1, $2, $3, $4)`,
      [profile.id, booking.id, points, reason]
    );
    const { rows: updated } = await client.query(
      `UPDATE profiles SET home_points = home_points + $2 WHERE id = $1
       RETURNING id, home_points`,
      [profile.id, points]
    );
    await client.query('COMMIT');
    return { awarded: true, points, balance: updated[0]?.home_points };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { awardPointsForBooking };
