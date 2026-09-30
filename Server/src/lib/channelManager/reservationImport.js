const { query } = require('../../config/db');
const { normalizeBookingSource } = require('../bookingSources');

/**
 * Upsert an OTA reservation into Cairo Homes by (connection_id, external_reservation_id).
 * Expects a normalized payload from channel providers.
 */
async function upsertChannelReservation({
  connectionId,
  bookingSource,
  externalReservationId,
  unitId,
  guestName,
  guestPhone = null,
  guestEmail = null,
  checkIn,
  checkOut,
  totalAmount = 0,
  channelCommissionAmount = null,
  channelCommissionPct = null,
  status = 'confirmed',
  notes = null,
  adults = 1,
  children = 0,
} = {}) {
  if (!connectionId || !externalReservationId || !unitId || !checkIn || !checkOut) {
    throw new Error('connectionId, externalReservationId, unitId, checkIn, and checkOut are required');
  }

  const source = normalizeBookingSource(bookingSource) || 'Manual';
  const st = String(status || 'confirmed').toLowerCase() === 'cancelled' ? 'cancelled' : 'confirmed';

  const { rows: existing } = await query(
    `SELECT id FROM reservations
     WHERE channel_connection_id = $1 AND external_reservation_id = $2`,
    [connectionId, String(externalReservationId)]
  );

  if (existing[0]) {
    const { rows } = await query(
      `UPDATE reservations SET
         unit_id = $2,
         guest_name = COALESCE($3, guest_name),
         guest_phone = COALESCE($4, guest_phone),
         guest_email = COALESCE($5, guest_email),
         check_in = $6::date,
         check_out = $7::date,
         total_amount = COALESCE($8, total_amount),
         channel_commission_amount = COALESCE($9, channel_commission_amount),
         channel_commission_pct = COALESCE($10, channel_commission_pct),
         booking_source = $11,
         status = $12,
         notes = COALESCE($13, notes),
         adults = COALESCE($14, adults),
         children = COALESCE($15, children),
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        existing[0].id,
        unitId,
        guestName,
        guestPhone,
        guestEmail,
        checkIn,
        checkOut,
        totalAmount,
        channelCommissionAmount,
        channelCommissionPct,
        source,
        st,
        notes,
        adults,
        children,
      ]
    );
    return { action: 'updated', reservation: rows[0] };
  }

  const { rows } = await query(
    `INSERT INTO reservations (
       unit_id, guest_name, guest_phone, guest_email,
       check_in, check_out, total_amount, amount_paid, payment_status,
       booking_source, status, notes, adults, children,
       channel_commission_amount, channel_commission_pct,
       external_reservation_id, channel_connection_id
     ) VALUES (
       $1,$2,$3,$4,$5::date,$6::date,$7,0,'pending',
       $8,$9,$10,$11,$12,$13,$14,$15,$16
     )
     RETURNING *`,
    [
      unitId,
      guestName || 'OTA Guest',
      guestPhone,
      guestEmail,
      checkIn,
      checkOut,
      Number(totalAmount) || 0,
      source,
      st,
      notes,
      adults || 1,
      children || 0,
      channelCommissionAmount,
      channelCommissionPct,
      String(externalReservationId),
      connectionId,
    ]
  );
  return { action: 'created', reservation: rows[0] };
}

async function cancelChannelReservation(connectionId, externalReservationId) {
  const { rows } = await query(
    `UPDATE reservations
     SET status = 'cancelled', updated_at = now()
     WHERE channel_connection_id = $1 AND external_reservation_id = $2
     RETURNING *`,
    [connectionId, String(externalReservationId)]
  );
  return rows[0] || null;
}

module.exports = {
  upsertChannelReservation,
  cancelChannelReservation,
};
