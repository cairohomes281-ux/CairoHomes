const { query } = require('../config/db');
const { sendBookingAcceptedEmail } = require('./guestEmails');
const { sendBookingAcceptedWhatsApp } = require('./guestWhatsApp');
const {
  pickLeastLoadedReservationsAgent,
  assertBookingAssigned,
  isWebsiteReservationsAgent,
  isAdmin,
} = require('../lib/reservationScope');

async function pickSalesAssignee() {
  return pickLeastLoadedReservationsAgent();
}

async function acceptWebsiteBooking(bookingId, staffUser, options = {}) {
  const { rows } = await query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const booking = rows[0];
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (!['pending', 'held'].includes(booking.status)) {
    const err = new Error(`Cannot accept booking in status ${booking.status}`);
    err.status = 409;
    throw err;
  }

  assertBookingAssigned(staffUser, booking);

  const total = Number(booking.total_egp) || 0;
  const method = String(booking.payment_method || '').toLowerCase();
  const alreadyPaid =
    booking.payment_status === 'paid' || method.includes('paymob') || method.includes('card');

  let amountPaid = alreadyPaid ? total : Number(options.amountPaid);
  const evidenceUrl = options.evidenceUrl || null;
  const evidenceName = options.evidenceName || null;
  const paymentMode = String(options.paymentMode || '').toLowerCase();

  if (!alreadyPaid) {
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      const err = new Error('Enter how much the guest paid (at least 50% of total)');
      err.status = 400;
      throw err;
    }
    const minDeposit = Math.round(total * 0.5 * 100) / 100;
    if (amountPaid + 0.009 < minDeposit) {
      const err = new Error(
        `InstaPay/Cash bookings require at least 50% deposit (EGP ${minDeposit.toLocaleString()}). Received EGP ${amountPaid.toLocaleString()}.`
      );
      err.status = 400;
      throw err;
    }
    if (amountPaid > total + 0.5) {
      const err = new Error('Paid amount cannot exceed the reservation total');
      err.status = 400;
      throw err;
    }
    if (!evidenceUrl) {
      const err = new Error('Upload payment evidence before accepting InstaPay/Cash bookings');
      err.status = 400;
      throw err;
    }
  } else {
    amountPaid = total;
  }

  const remaining = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const paymentStatus =
    remaining <= 0.5 ? 'paid' : amountPaid > 0 ? 'partial' : 'pending';

  let commissionNote = null;
  if (booking.unit_id) {
    const { rows: units } = await query(`SELECT * FROM units WHERE id = $1`, [booking.unit_id]);
    const unit = units[0];
    if (unit) {
      commissionNote = JSON.stringify({
        commission_mode: unit.commission_mode,
        company_commission_pct: unit.company_commission_pct,
        company_commission_owner_pct: unit.company_commission_owner_pct,
        commission_tenant_pct: unit.commission_tenant_pct,
        accepted_by: staffUser?.id || null,
        accepted_by_name: staffUser?.full_name || staffUser?.username || null,
        accepted_at: new Date().toISOString(),
        deposit_mode: paymentMode || (alreadyPaid ? 'prepaid' : 'manual'),
        amount_paid: amountPaid,
        remaining,
      });
    }
  }

  // The agent who accepts a website request owns the resulting reservation.
  const assignee =
    (isWebsiteReservationsAgent(staffUser) || isAdmin(staffUser) ? staffUser?.id : null) ||
    booking.assigned_sales_id ||
    (await pickLeastLoadedReservationsAgent());

  if (!assignee) {
    const err = new Error('No website reservations agent available to own this booking');
    err.status = 400;
    throw err;
  }

  const depositNote = alreadyPaid
    ? null
    : `[deposit] mode=${paymentMode || 'custom'} paid=${amountPaid} remaining=${remaining}`;

  const { rows: updated } = await query(
    `UPDATE bookings SET
       status = 'confirmed',
       hold_expires_at = NULL,
       payment_status = $4,
       assigned_sales_id = $3,
       notes = CASE
         WHEN $2::text IS NULL AND $5::text IS NULL THEN notes
         ELSE COALESCE(notes || E'\n', '')
           || COALESCE(('[commission] ' || $2::text), '')
           || CASE WHEN $2::text IS NOT NULL AND $5::text IS NOT NULL THEN E'\n' ELSE '' END
           || COALESCE($5::text, '')
       END
     WHERE id = $1
     RETURNING *`,
    [bookingId, commissionNote, assignee, paymentStatus, depositNote]
  );

  
  let reservationId = null;
  if (booking.unit_id) {
    const nights = Math.max(
      1,
      Math.round((new Date(booking.checkout) - new Date(booking.checkin)) / 86400000)
    );
    const createdBy = staffUser?.id || assignee;
    if (!createdBy) {
      const err = new Error('No staff user available to own reservation');
      err.status = 400;
      throw err;
    }
    const existing = await query(`SELECT id FROM reservations WHERE booking_id = $1`, [bookingId]);
    if (!existing.rows[0]) {
      let pricePerNight = 0;
      let utilitiesAmount = 0;
      let housekeepingFees = 0;
      let beachAccessFees = 0;
      let stayTotal = Number(booking.total_egp) || 0;

      const { rows: units } = await query(`SELECT * FROM units WHERE id = $1`, [booking.unit_id]);
      const unit = units[0];
      if (unit) {
        const { housekeepingFeeForUnit } = require('../lib/housekeeping');
        housekeepingFees = housekeepingFeeForUnit(unit);
        const costPerNight = parseFloat(unit.utilities_cost) || 0;
        if (costPerNight > 0) utilitiesAmount = costPerNight * nights;

        try {
          const { quoteStay } = require('./pricing');
          const partyAdults = Number(booking.adults) > 0
            ? Number(booking.adults)
            : Number(booking.guests) || 1;
          const partyChildren = Number(booking.children) || 0;
          
          const quote = await quoteStay({
            wpPostId: unit.wp_post_id,
            checkin: booking.checkin,
            checkout: booking.checkout,
            unit,
            adults: partyAdults,
            teens: partyChildren,
            skipBlockCheck: true,
          });
          if (quote?.available) {
            // Fee lines from current quote; stay total stays on booking.total_egp (promo already applied).
            pricePerNight = nights > 0 ? Number(quote.base_subtotal || quote.subtotal || 0) / nights : 0;
            housekeepingFees = Number(quote.cleaning_fee_egp) || housekeepingFees;
            beachAccessFees = Number(quote.access_fee_egp) || 0;
          }
        } catch (_) {}

        if (!(beachAccessFees > 0)) {
          try {
            const { computeBeachAccessFee } = require('../lib/beachAccess');
            const partyAdults = Number(booking.adults) > 0
              ? Number(booking.adults)
              : Number(booking.guests) || 1;
            const partyChildren = Number(booking.children) || 0;
            beachAccessFees = (
              await computeBeachAccessFee(unit, {
                nights,
                adults: partyAdults,
                teens: partyChildren,
              })
            ).fee;
          } catch (_) {}
        }
      }

      if (!(pricePerNight > 0) && stayTotal > 0) {
        const { ownerAccommodationGross } = require('../lib/commission');
        const nightsGross = ownerAccommodationGross(
          {
            nights,
            total_amount: stayTotal,
            housekeeping_fees: housekeepingFees,
            utilities_amount: utilitiesAmount,
          },
          unit || {}
        );
        pricePerNight = nights > 0 ? nightsGross / nights : 0;
      }

      
      const paidCap = Math.min(amountPaid, stayTotal);
      const rem = Math.max(0, Math.round((stayTotal - paidCap) * 100) / 100);
      const resPayStatus = rem <= 0.5 ? 'paid' : paidCap > 0 ? 'partial' : 'pending';

      const partyAdults = Number(booking.adults) > 0
        ? Number(booking.adults)
        : Number(booking.guests) || 1;
      const partyChildren = Math.max(0, Number(booking.children) || 0);
      const partyNanny = Math.max(0, Number(booking.nanny_count) || 0);

      const { rows: inserted } = await query(
        `INSERT INTO reservations (
           unit_id, guest_name, guest_email, guest_phone, check_in, check_out, nights,
           total_amount, amount_paid, payment_status, booking_source, sales_person_id,
           status, notes, booking_id, created_by, id_photo_urls, price_per_night,
           utilities_amount, housekeeping_fees, transfer_proof_path, transfer_proof_name,
           down_payment, payment_method,
           broker_name, broker_amount_per_night, broker_total,
           owner_collected_type, owner_collected_amount,
           adults, children, nanny_count, beach_access_fees
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Website',$11,'confirmed',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
         RETURNING id`,
        [
          booking.unit_id,
          booking.guest_name,
          booking.guest_email,
          booking.guest_phone,
          booking.checkin,
          booking.checkout,
          nights,
          stayTotal,
          paidCap,
          resPayStatus,
          assignee || createdBy,
          booking.notes,
          bookingId,
          createdBy,
          booking.id_photo_urls || [],
          pricePerNight,
          utilitiesAmount,
          housekeepingFees,
          evidenceUrl,
          evidenceName,
          paidCap,
          method.includes('instapay')
            ? 'instapay'
            : method.includes('cash')
              ? 'cash'
              : method.includes('paymob') || method.includes('card')
                ? 'paymob_card'
                : null,
          booking.broker_name || null,
          parseFloat(booking.broker_amount_per_night) || 0,
          parseFloat(booking.broker_total) || 0,
          booking.owner_collected_type || null,
          parseFloat(booking.owner_collected_amount) || 0,
          partyAdults,
          partyChildren,
          partyNanny,
          Number(beachAccessFees) || 0,
        ]
      );
      reservationId = inserted[0]?.id || null;
      if (reservationId) {
        try {
          const { rows: full } = await query(`SELECT * FROM reservations WHERE id = $1`, [
            reservationId,
          ]);
          const { syncBlocksForReservation } = require('../lib/reservationBlocks');
          await syncBlocksForReservation(full[0]);
        } catch (err) {
          console.warn('[bookingWorkflow] block sync failed', err.message);
        }
      }
    } else {
      reservationId = existing.rows[0].id;
      await query(
        `UPDATE reservations
         SET status = 'confirmed',
             sales_person_id = COALESCE(sales_person_id, $2),
             amount_paid = GREATEST(COALESCE(amount_paid, 0), $3),
             payment_status = $4,
             transfer_proof_path = COALESCE($5, transfer_proof_path),
             transfer_proof_name = COALESCE($6, transfer_proof_name),
             down_payment = COALESCE(down_payment, $3),
             updated_at = now()
         WHERE booking_id = $1`,
        [bookingId, assignee, amountPaid, paymentStatus, evidenceUrl, evidenceName]
      );
      try {
        const { rows: full } = await query(`SELECT * FROM reservations WHERE id = $1`, [
          reservationId,
        ]);
        const { syncBlocksForReservation } = require('../lib/reservationBlocks');
        await syncBlocksForReservation(full[0]);
      } catch (err) {
        console.warn('[bookingWorkflow] block sync failed', err.message);
      }
    }
  }

  
  if (!alreadyPaid && amountPaid > 0) {
    try {
      const payMethod = method.includes('instapay')
        ? 'instapay'
        : method.includes('cash')
          ? 'cash'
          : 'bank_transfer';
      await query(
        `INSERT INTO payments (
           reservation_id, booking_id, amount, payment_date, payment_method,
           reference_number, notes, document_path, document_name, created_by,
           status, is_approved, approved_by, approved_at
         ) VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,$6,$7,$8,$9,'successful',1,$9,now())`,
        [
          reservationId,
          bookingId,
          amountPaid,
          payMethod,
          paymentMode || 'deposit',
          `Accept deposit (${paymentMode || 'custom'}) — remaining EGP ${remaining}`,
          evidenceUrl,
          evidenceName,
          staffUser.id,
        ]
      );
    } catch (payErr) {
      console.error('[accept] payment insert failed:', payErr.message);
    }
  } else if (alreadyPaid && reservationId) {
    
    try {
      await query(
        `UPDATE payments
         SET reservation_id = COALESCE(reservation_id, $1)
         WHERE booking_id = $2`,
        [reservationId, bookingId]
      );
    } catch (linkErr) {
      console.error('[accept] payment link failed:', linkErr.message);
    }
  }

  try {
    await sendBookingAcceptedEmail(updated[0]);
  } catch (emailErr) {
    console.error('[email] Acceptance email failed:', emailErr.message);
  }

  try {
    await sendBookingAcceptedWhatsApp(updated[0]);
  } catch (waErr) {
    console.error('[whatsapp] Acceptance message failed:', waErr.message);
  }

  try {
    const { awardPointsForBooking } = require('../lib/homePoints');
    await awardPointsForBooking(updated[0], { reason: 'reservation_accepted' });
  } catch (pointsErr) {
    console.error('[points] Award failed:', pointsErr.message);
  }

  return {
    ...updated[0],
    amount_paid: amountPaid,
    remaining,
    payment_status: paymentStatus,
    reservation_id: reservationId,
  };
}


/**
 * Website agent: set how much has been collected for an accepted booking.
 * Updates the linked reservation + booking payment_status; inserts a payment
 * row when the collected amount increases.
 */
async function updateWebsiteBookingCollectedAmount(bookingId, staffUser, options = {}) {
  const { rows } = await query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const booking = rows[0];
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (String(booking.status || '').toLowerCase() !== 'confirmed') {
    const err = new Error('Only accepted (confirmed) bookings can update collected money');
    err.status = 409;
    throw err;
  }

  assertBookingAssigned(staffUser, booking);

  const method = String(booking.payment_method || '').toLowerCase();
  const prepaid =
    booking.payment_status === 'paid' || method.includes('paymob') || method.includes('card');
  if (prepaid && /paymob|card/i.test(method)) {
    const err = new Error('Card/Paymob bookings are already fully paid online');
    err.status = 400;
    throw err;
  }

  const amountPaid = Number(options.amountPaid);
  if (!Number.isFinite(amountPaid) || amountPaid < 0) {
    const err = new Error('Enter a valid collected amount');
    err.status = 400;
    throw err;
  }

  const { rows: resRows } = await query(
    `SELECT * FROM reservations WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [bookingId]
  );
  const reservation = resRows[0];
  if (!reservation) {
    const err = new Error('No linked reservation for this booking yet');
    err.status = 404;
    throw err;
  }

  const total =
    Math.max(0, Number(reservation.total_amount) || 0) || Math.max(0, Number(booking.total_egp) || 0);
  if (amountPaid > total + 0.5) {
    const err = new Error('Collected amount cannot exceed the reservation total');
    err.status = 400;
    throw err;
  }

  const currentPaid = Math.max(0, Number(reservation.amount_paid) || 0);
  const roundedPaid = Math.round(amountPaid * 100) / 100;
  const delta = Math.round((roundedPaid - currentPaid) * 100) / 100;
  const remaining = Math.max(0, Math.round((total - roundedPaid) * 100) / 100);

  if (Math.abs(delta) <= 0.009) {
    return {
      ...booking,
      amount_paid: currentPaid,
      amount_due: remaining,
      payment_status: reservation.payment_status || booking.payment_status,
      reservation_id: reservation.id,
    };
  }

  const payMethodRaw = String(options.paymentMethod || options.payment_method || 'cash').toLowerCase();
  const payMethod = payMethodRaw.includes('instapay')
    ? 'instapay'
    : payMethodRaw.includes('transfer') || payMethodRaw.includes('bank')
      ? 'bank_transfer'
      : 'cash';

  if (delta > 0.009) {
    await query(
      `INSERT INTO payments (
         reservation_id, booking_id, amount, payment_date, payment_method,
         reference_number, notes, created_by,
         status, is_approved, approved_by, approved_at, paid_at
       ) VALUES (
         $1, $2, $3, CURRENT_DATE, $4,
         'collected_update', $5, $6,
         'successful', 1, $6, now(), now()
       )`,
      [
        reservation.id,
        bookingId,
        delta,
        payMethod,
        `Website agent collected update — set to EGP ${roundedPaid.toLocaleString()} (was ${currentPaid.toLocaleString()}; remaining EGP ${remaining.toLocaleString()})`,
        staffUser?.id || null,
      ]
    );
  }

  const { syncReservationPaymentStatus, paymentStatusFrom } = require('../lib/syncReservationPayment');
  let synced = null;
  if (delta > 0.009) {
    synced = await syncReservationPaymentStatus(reservation.id);
  }

  const finalPaid =
    delta > 0.009
      ? Math.max(roundedPaid, Number(synced?.amount_paid) || 0)
      : roundedPaid;
  const finalStatus = paymentStatusFrom(total, finalPaid);

  const { rows: updatedRes } = await query(
    `UPDATE reservations
     SET amount_paid = $2,
         payment_status = $3,
         down_payment = CASE
           WHEN COALESCE(down_payment, 0) < $2 THEN $2
           ELSE down_payment
         END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [reservation.id, finalPaid, finalStatus]
  );

  const noteLine = `[collected] paid=${finalPaid} remaining=${Math.max(
    0,
    Math.round((total - finalPaid) * 100) / 100
  )} by=${staffUser?.full_name || staffUser?.username || staffUser?.id || 'agent'} at=${new Date().toISOString()}`;

  const { rows: updatedBooking } = await query(
    `UPDATE bookings
     SET payment_status = $2,
         notes = COALESCE(notes || E'\\n', '') || $3
     WHERE id = $1
     RETURNING *`,
    [bookingId, finalStatus, noteLine]
  );

  return {
    ...updatedBooking[0],
    amount_paid: finalPaid,
    amount_due: Math.max(0, Math.round((total - finalPaid) * 100) / 100),
    payment_status: finalStatus,
    reservation_id: reservation.id,
    reservation: updatedRes[0] || null,
  };
}

async function cancelWebsiteBooking(bookingId, reason = 'cancelled_by_staff') {
  if (!bookingId) return null;

  const { rows: updated } = await query(
    `UPDATE bookings SET
       status = 'cancelled',
       hold_expires_at = NULL,
       cancellation_reason = COALESCE($2, cancellation_reason),
       payment_status = CASE
         WHEN payment_status = 'paid' THEN 'refund_noted'
         ELSE payment_status
       END
     WHERE id = $1
       AND status IN ('confirmed', 'pending', 'held')
     RETURNING *`,
    [bookingId, reason]
  );

  return updated[0] || null;
}

async function rejectWebsiteBooking(bookingId, staffUser, reason = '') {
  const reasonText = String(reason || '').trim();
  if (!reasonText) {
    const err = new Error('A rejection reason is required');
    err.status = 400;
    throw err;
  }

  const { rows } = await query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const booking = rows[0];
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
  if (!['pending', 'held'].includes(booking.status)) {
    const err = new Error(`Cannot reject booking in status ${booking.status}`);
    err.status = 409;
    throw err;
  }

  assertBookingAssigned(staffUser, booking);

  const rejectMeta = JSON.stringify({
    rejected_by: staffUser?.id || null,
    rejected_by_name: staffUser?.full_name || staffUser?.username || null,
    rejected_at: new Date().toISOString(),
    reject_reason: reasonText,
  });

  await query(
    `UPDATE bookings SET
       notes = CASE
         WHEN notes IS NULL OR btrim(notes) = '' THEN $2
         ELSE notes || E'\n' || $2
       END,
       assigned_sales_id = COALESCE($3, assigned_sales_id)
     WHERE id = $1`,
    [bookingId, rejectMeta, isWebsiteReservationsAgent(staffUser) ? staffUser.id : null]
  );

  const updated = await cancelWebsiteBooking(bookingId, reasonText);

  await query(
    `UPDATE reservations SET
       status = 'cancelled',
       notes = CASE
         WHEN notes IS NULL OR btrim(notes) = '' THEN $2
         ELSE notes || E'\n' || $2
       END,
       updated_at = now()
     WHERE booking_id = $1`,
    [bookingId, `[rejected] ${reasonText}`]
  );

  try {
    const { rows: cancelled } = await query(
      `SELECT * FROM reservations WHERE booking_id = $1`,
      [bookingId]
    );
    const { syncBlocksForReservation } = require('../lib/reservationBlocks');
    for (const r of cancelled) await syncBlocksForReservation(r);
  } catch (err) {
    console.warn('[bookingWorkflow] block release on reject failed', err.message);
  }

  return updated;
}


async function assignSalesOnCreate(bookingId) {
  const { rows: bookingRows } = await query(`SELECT * FROM bookings WHERE id = $1`, [bookingId]);
  const booking = bookingRows[0];
  if (!booking) return null;

  try {
    const { notifyNewWebsiteBooking } = require('./pmsNotifications');
    await notifyNewWebsiteBooking(booking, { assigneeId: null });
  } catch (err) {
    console.error('[assignSalesOnCreate] notify failed', err.message);
  }

  return null;
}


module.exports = {
  acceptWebsiteBooking,
  rejectWebsiteBooking,
  cancelWebsiteBooking,
  updateWebsiteBookingCollectedAmount,
  pickSalesAssignee,
  assignSalesOnCreate,
};
