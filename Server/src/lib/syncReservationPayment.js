
const { query } = require('../config/db');

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
    `SELECT id, total_amount, status, down_payment FROM reservations WHERE id = $1`,
    [reservationId]
  );
  const reservation = resRows[0];
  if (!reservation) return null;

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
