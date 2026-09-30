const { query } = require('../config/db');


function startBookingHoldExpiryJob() {
  const interval = Number(process.env.BOOKING_HOLD_SWEEP_INTERVAL_MS || 60000);
  const timer = setInterval(async () => {
    try {
      const { rowCount } = await query(
        `UPDATE bookings
         SET status = 'cancelled', cancellation_reason = 'hold_expired', hold_expires_at = NULL
         WHERE status = 'held'
           AND hold_expires_at IS NOT NULL
           AND hold_expires_at < now()
           AND payment_status IS DISTINCT FROM 'paid'`
      );
      if (rowCount) console.log(`[hold-expiry] cancelled ${rowCount} held bookings`);
    } catch (err) {
      console.error('[hold-expiry]', err.message);
    }
  }, interval);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { startBookingHoldExpiryJob };
