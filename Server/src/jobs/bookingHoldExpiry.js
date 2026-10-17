const { query } = require('../config/db');

async function expireHeldBookings() {
  const { rowCount } = await query(
    `UPDATE bookings
     SET status = 'cancelled', cancellation_reason = 'hold_expired', hold_expires_at = NULL
     WHERE status = 'held'
       AND hold_expires_at IS NOT NULL
       AND hold_expires_at < now()
       AND payment_status IS DISTINCT FROM 'paid'`
  );
  return rowCount || 0;
}

async function expireHeldReservations() {
  const { rows } = await query(
    `UPDATE reservations
     SET status = 'cancelled',
         notes = btrim(COALESCE(notes, '') || E'\nHold expired.'),
         hold_expires_at = NULL,
         updated_at = now()
     WHERE status IN ('pending', 'hold')
       AND hold_expires_at IS NOT NULL
       AND hold_expires_at < now()
       AND COALESCE(amount_paid, 0) <= 0
       AND payment_status IS DISTINCT FROM 'paid'
     RETURNING *`
  );
  if (!rows.length) return 0;
  const { syncBlocksForReservation } = require('../lib/reservationBlocks');
  for (const row of rows) {
    try {
      await syncBlocksForReservation(row);
    } catch (err) {
      console.warn('[hold-expiry] reservation block release failed', row.id, err.message);
    }
  }
  return rows.length;
}

function startBookingHoldExpiryJob() {
  const interval = Number(process.env.BOOKING_HOLD_SWEEP_INTERVAL_MS || 60000);
  const timer = setInterval(async () => {
    try {
      const bookings = await expireHeldBookings();
      if (bookings) console.log(`[hold-expiry] cancelled ${bookings} held bookings`);
      const reservations = await expireHeldReservations();
      if (reservations) console.log(`[hold-expiry] cancelled ${reservations} held reservations`);
    } catch (err) {
      console.error('[hold-expiry]', err.message);
    }
  }, interval);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  startBookingHoldExpiryJob,
  expireHeldBookings,
  expireHeldReservations,
};
