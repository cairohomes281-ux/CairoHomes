const { query } = require('../config/db');
const { syncReservationPaymentStatus } = require('./syncReservationPayment');

function isCancelled(status) {
  return String(status || '').toLowerCase() === 'cancelled';
}

function isFullyPaid(row) {
  const total = Number(row.total_amount) || 0;
  const paid = Number(row.amount_paid) || 0;
  if (total <= 0.5) return String(row.payment_status || '').toLowerCase() === 'paid' || paid <= 0.5;
  return (
    String(row.payment_status || '').toLowerCase() === 'paid' && paid + 0.5 >= total
  );
}

function needsSettlement(row) {
  if (!row || isCancelled(row.status)) return false;
  if (String(row.status || '').toLowerCase() === 'pending') return true;
  if (!isFullyPaid(row)) return true;
  if (Number(row.ops_money_collected) !== 1) return true;
  return false;
}

/**
 * Mark a reservation as fully paid + ops-collected.
 * Pending status becomes confirmed (accepted).
 * Inserts a balancing payment when amount_paid is short of total.
 */
async function markReservationFullyCollected(
  reservationId,
  { reason = 'auto_settled', actorId = null } = {}
) {
  if (!reservationId) return null;

  const { rows } = await query(
    `SELECT id, status, payment_status, amount_paid, total_amount,
            down_payment, ops_money_collected, check_in, check_out
     FROM reservations WHERE id = $1`,
    [reservationId]
  );
  const row = rows[0];
  if (!row || isCancelled(row.status)) return null;
  if (!needsSettlement(row)) return row;

  const total = Math.max(0, Number(row.total_amount) || 0);
  const paid = Math.max(0, Number(row.amount_paid) || 0);
  const shortfall = Math.round((total - paid) * 100) / 100;

  if (shortfall > 0.5) {
    await query(
      `INSERT INTO payments (
         reservation_id, amount, payment_date, payment_method,
         notes, created_by, status, is_approved, approved_by, approved_at, paid_at
       ) VALUES (
         $1, $2, CURRENT_DATE, 'cash',
         $3, $4, 'successful', 1, $4, now(), now()
       )`,
      [
        reservationId,
        shortfall,
        `[${reason}] Auto-settled remaining balance`,
        actorId,
      ]
    );
  }

  await syncReservationPaymentStatus(reservationId);

  const nextStatus =
    String(row.status || '').toLowerCase() === 'pending' ? 'confirmed' : null;

  const { rows: updated } = await query(
    `UPDATE reservations SET
       amount_paid = GREATEST(COALESCE(amount_paid, 0), COALESCE(total_amount, 0)),
       payment_status = 'paid',
       status = COALESCE($2, status),
       ops_money_collected = 1,
       ops_money_collected_at = COALESCE(ops_money_collected_at, now()),
       ops_money_collected_by = COALESCE(ops_money_collected_by, $3),
       ops_money_collected_amount = GREATEST(
         COALESCE(ops_money_collected_amount, 0),
         COALESCE(total_amount, 0)
       ),
       updated_at = now()
     WHERE id = $1
       AND status IS DISTINCT FROM 'cancelled'
     RETURNING *`,
    [reservationId, nextStatus, actorId]
  );

  return updated[0] || null;
}

/** Past checkout (non-cancelled): accept + fully paid + collected. */
async function settlePastCheckoutReservations({ actorId = null } = {}) {
  const { rows } = await query(
    `SELECT id FROM reservations
     WHERE status IS DISTINCT FROM 'cancelled'
       AND check_out::date < CURRENT_DATE
       AND (
         status = 'pending'
         OR COALESCE(payment_status, 'pending') IS DISTINCT FROM 'paid'
         OR COALESCE(amount_paid, 0) + 0.5 < COALESCE(total_amount, 0)
         OR COALESCE(ops_money_collected, 0) = 0
       )
     ORDER BY id`
  );

  let settled = 0;
  for (const r of rows) {
    const out = await markReservationFullyCollected(r.id, {
      reason: 'past_checkout_settled',
      actorId,
    });
    if (out) settled += 1;
  }
  return { candidates: rows.length, settled };
}

/** Handed-over stays must be fully collected. */
async function settleHandedOverReservations({ actorId = null } = {}) {
  const { rows } = await query(
    `SELECT id FROM reservations
     WHERE status IS DISTINCT FROM 'cancelled'
       AND COALESCE(ops_handed_over, 0) = 1
       AND (
         status = 'pending'
         OR COALESCE(payment_status, 'pending') IS DISTINCT FROM 'paid'
         OR COALESCE(amount_paid, 0) + 0.5 < COALESCE(total_amount, 0)
         OR COALESCE(ops_money_collected, 0) = 0
       )
     ORDER BY id`
  );

  let settled = 0;
  for (const r of rows) {
    const out = await markReservationFullyCollected(r.id, {
      reason: 'ops_handover_settled',
      actorId,
    });
    if (out) settled += 1;
  }
  return { candidates: rows.length, settled };
}

async function settleReservationMoneySweep() {
  const past = await settlePastCheckoutReservations();
  const handed = await settleHandedOverReservations();
  return { past, handed };
}

module.exports = {
  markReservationFullyCollected,
  settlePastCheckoutReservations,
  settleHandedOverReservations,
  settleReservationMoneySweep,
  needsSettlement,
};
