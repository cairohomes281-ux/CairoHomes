
const { query } = require('../config/db');
const { isAirbnbBookingSource, isOutsideChannelSource } = require('./bookingSources');

function paymentStatusFrom(totalAmount, amountPaid) {
  const total = Math.max(0, Number(totalAmount) || 0);
  const paid = Math.max(0, Number(amountPaid) || 0);
  if (paid <= 0.009) return 'pending';
  if (total > 0 && paid + 0.5 >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'pending';
}

async function syncReservationPaymentStatus(reservationId) {
  if (!reservationId) return null;

  const { rows: resRows } = await query(
    `SELECT id, total_amount, amount_paid, payment_status, status, down_payment, booking_source, ota_event_uid
     FROM reservations WHERE id = $1`,
    [reservationId]
  );
  const reservation = resRows[0];
  if (!reservation) return null;

  const alreadyPaid =
    String(reservation.payment_status || '').toLowerCase() === 'paid' &&
    Number(reservation.amount_paid) + 0.5 >= Number(reservation.total_amount) &&
    Number(reservation.total_amount) > 0;
  if (alreadyPaid && isOutsideChannelSource(reservation.booking_source) && reservation.ota_event_uid) {
    const { rows: recorded } = await query(
      `SELECT 1 FROM payments
       WHERE reservation_id = $1 AND status = 'successful' AND COALESCE(is_approved, 0) = 1
       LIMIT 1`,
      [reservationId]
    );
    if (!recorded[0]) return reservation;
  }

  if (isAirbnbBookingSource(reservation.booking_source)) {
    const current = String(reservation.status || '').toLowerCase();
    if (current === 'cancelled') return reservation;
    const total = Math.max(0, Number(reservation.total_amount) || 0);
    const nextStatus = current === 'pending' || current === 'hold' ? 'confirmed' : reservation.status;
    const { rows } = await query(
      `UPDATE reservations
       SET amount_paid = $1,
           payment_status = 'paid',
           status = $2,
           updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [total, nextStatus, reservationId]
    );
    return rows[0] || null;
  }

  const { rows: payRows } = await query(
    `SELECT COALESCE(SUM(amount), 0)::float AS paid
     FROM payments
     WHERE reservation_id = $1
       AND status = 'successful'
       AND COALESCE(is_approved, 0) = 1`,
    [reservationId]
  );

  const fromPayments = Number(payRows[0]?.paid) || 0;
  const down = Number(reservation.down_payment) || 0;
  
  const amountPaid = fromPayments > 0 ? fromPayments : down;
  const paymentStatus = paymentStatusFrom(reservation.total_amount, amountPaid);

  let nextStatus = reservation.status;
  if (
    String(reservation.status || '').toLowerCase() === 'pending' &&
    amountPaid > 0 &&
    paymentStatus !== 'pending'
  ) {
    nextStatus = 'confirmed';
  }

  const { rows } = await query(
    `UPDATE reservations
     SET amount_paid = $1,
         payment_status = $2,
         status = $3,
         updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [amountPaid, paymentStatus, nextStatus, reservationId]
  );
  return rows[0] || null;
}

module.exports = {
  syncReservationPaymentStatus,
  paymentStatusFrom,
};
