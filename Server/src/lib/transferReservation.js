const { pool, query } = require('../config/db');
const { quoteStay, toIsoDate, nightsBetween, getBlockedDates } = require('../services/pricing');
const { housekeepingFeeForUnit } = require('./housekeeping');
const { computeBeachAccessFee } = require('./beachAccess');
const { paymentStatusFrom } = require('./syncReservationPayment');
const { validatePromo, redeemPromo, guestKeyFrom } = require('./promoCodes');
const { logAudit } = require('./audit');

function iso(value) {
  return toIsoDate(value);
}

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function dateStr(row, key) {
  const raw = row?.[key];
  return iso(raw) || (raw ? String(raw).slice(0, 10) : null);
}

async function loadReservation(id) {
  const { rows } = await query(`SELECT * FROM reservations WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function loadUnit(id) {
  const { rows } = await query(`SELECT * FROM units WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function assertNewUnitAvailable(unit, checkIn, checkOut, { excludeReservationId } = {}) {
  if (!unit?.wp_post_id) return;
  const blocked = await getBlockedDates(unit.wp_post_id, checkIn, checkOut, {
    includeUnpriced: false,
  });
  let dates = blocked.map((b) => b.date);
  if (excludeReservationId) {
    const { rows } = await query(
      `SELECT d::text AS date
       FROM reservations r,
            generate_series(r.check_in, r.check_out - 1, interval '1 day') d
       WHERE r.id = $1`,
      [excludeReservationId]
    );
    const own = new Set(rows.map((r) => r.date));
    dates = dates.filter((d) => !own.has(d));
  }
  if (dates.length) {
    const err = new Error(
      `New unit is not available on ${dates.slice(0, 5).join(', ')}${dates.length > 5 ? '…' : ''}`
    );
    err.status = 409;
    err.conflicts = dates.slice(0, 12);
    throw err;
  }
}

async function priceTransferStay({ source, unit, checkIn, checkOut }) {
  const nights = nightsBetween(checkIn, checkOut);
  if (!(nights > 0)) {
    const err = new Error('Check-out must be after check-in');
    err.status = 400;
    throw err;
  }

  const adults = Math.max(0, Number(source.adults) || 0);
  const children = Math.max(0, Number(source.children) || 0);
  const isWebsite = Boolean(source.booking_id);
  const insurance = Number(source.insurance) || 0;

  let quote = null;
  if (unit.wp_post_id) {
    quote = await quoteStay({
      wpPostId: unit.wp_post_id,
      checkin: checkIn,
      checkout: checkOut,
      unit,
      adults: adults > 0 ? adults : 1,
      teens: children,
      skipBlockCheck: true,
    });
  }

  const housekeeping = quote?.available
    ? Number(quote.cleaning_fee_egp) || housekeepingFeeForUnit(unit)
    : housekeepingFeeForUnit(unit);
  const beach = quote?.available
    ? Number(quote.access_fee_egp) || 0
    : (
        await computeBeachAccessFee(unit, {
          nights,
          adults: adults > 0 ? adults : 1,
          teens: children,
        })
      ).fee;
  const utilitiesPerNight = Number(unit.utilities_cost) || 0;
  const utilities = utilitiesPerNight > 0 ? roundMoney(utilitiesPerNight * nights) : 0;

  let accommodation = 0;
  let pricePerNight = 0;
  let serviceFees = 0;

  if (quote?.available) {
    if (isWebsite) {
      accommodation = Number(quote.subtotal) || 0;
      serviceFees = Number(quote.service_fee_egp) || 0;
      pricePerNight = nights > 0 ? accommodation / nights : 0;
    } else {
      accommodation = Number(quote.base_subtotal || quote.subtotal) || 0;
      pricePerNight = nights > 0 ? accommodation / nights : 0;
    }
  } else {
    const fallback = Number(unit.price_fallback) || Number(source.price_per_night) || 0;
    if (!(fallback > 0)) {
      const err = new Error('New unit has no price for these dates');
      err.status = 400;
      throw err;
    }
    pricePerNight = fallback;
    accommodation = roundMoney(fallback * nights);
  }

  const stayBeforePromo = roundMoney(
    accommodation + housekeeping + beach + utilities + serviceFees
  );

  return {
    nights,
    price_per_night: roundMoney(pricePerNight),
    accommodation: roundMoney(accommodation),
    housekeeping_fees: roundMoney(housekeeping),
    beach_access_fees: roundMoney(beach),
    utilities_amount: utilities,
    service_fees: roundMoney(serviceFees),
    insurance,
    stay_before_promo: stayBeforePromo,
    total_before_promo: roundMoney(stayBeforePromo + insurance),
    quote_available: Boolean(quote?.available),
  };
}

async function applyOptionalPromo({ source, promoCode, amount }) {
  const code = String(promoCode || '').trim();
  if (!code) return { promo: null, discount: 0, total: roundMoney(amount) };

  const validated = await validatePromo({
    code,
    amount,
    email: source.guest_email,
    phone: source.guest_phone,
    allowRepeat: true,
  });
  return {
    promo: {
      code: validated.code,
      discount_amount: validated.discount_amount_applied,
      discount_percent: validated.discount_percent,
    },
    discount: Number(validated.discount_amount_applied) || 0,
    total: roundMoney(validated.discounted_total),
  };
}

async function buildTransferPlan(source, { unit_id, check_in, check_out, promo_code } = {}) {
  if (!source) {
    const err = new Error('Reservation not found');
    err.status = 404;
    throw err;
  }
  if (String(source.status || '').toLowerCase() === 'cancelled') {
    const err = new Error('Cannot transfer a cancelled reservation');
    err.status = 409;
    throw err;
  }
  if (Number(source.is_owner_reservation) === 1 && !(Number(source.total_amount) > 0)) {
    const err = new Error('Owner blocked nights cannot be transferred');
    err.status = 409;
    throw err;
  }

  const newUnitId = String(unit_id || '').trim();
  if (!newUnitId) {
    const err = new Error('Choose a unit to transfer to');
    err.status = 400;
    throw err;
  }

  const checkIn = iso(check_in) || dateStr(source, 'check_in');
  const checkOut = iso(check_out) || dateStr(source, 'check_out');
  if (!checkIn || !checkOut) {
    const err = new Error('Check-in and check-out are required');
    err.status = 400;
    throw err;
  }

  if (newUnitId === String(source.unit_id) && checkIn === dateStr(source, 'check_in') && checkOut === dateStr(source, 'check_out')) {
    const err = new Error('Pick a different unit or different dates');
    err.status = 400;
    throw err;
  }

  const unit = await loadUnit(newUnitId);
  if (!unit) {
    const err = new Error('Unit not found');
    err.status = 404;
    throw err;
  }
  await assertNewUnitAvailable(unit, checkIn, checkOut, {
    excludeReservationId: source.id,
  });

  const priced = await priceTransferStay({ source, unit, checkIn, checkOut });
  const promo = await applyOptionalPromo({
    source,
    promoCode: promo_code,
    amount: priced.stay_before_promo,
  });
  const totalAmount = roundMoney(promo.total + priced.insurance);
  const amountPaid = Number(source.amount_paid) || 0;

  return {
    source,
    unit,
    check_in: checkIn,
    check_out: checkOut,
    priced,
    promo: promo.promo,
    discount: promo.discount,
    total_amount: totalAmount,
    amount_paid: amountPaid,
    amount_due: Math.max(0, roundMoney(totalAmount - amountPaid)),
    payment_status: paymentStatusFrom(totalAmount, amountPaid),
    from_unit: source.unit_id,
  };
}

async function previewTransfer(reservationId, body) {
  const source = await loadReservation(reservationId);
  const plan = await buildTransferPlan(source, body);
  return {
    from: {
      id: source.id,
      unit_id: source.unit_id,
      guest_name: source.guest_name,
      check_in: dateStr(source, 'check_in'),
      check_out: dateStr(source, 'check_out'),
      total_amount: Number(source.total_amount) || 0,
      amount_paid: Number(source.amount_paid) || 0,
      documents: Array.isArray(source.id_photo_urls) ? source.id_photo_urls.length : 0,
    },
    to: {
      unit_id: plan.unit.id,
      unit_number: plan.unit.unit_number,
      title: plan.unit.title,
      project: plan.unit.project || plan.unit.compound,
      check_in: plan.check_in,
      check_out: plan.check_out,
      nights: plan.priced.nights,
      price_per_night: plan.priced.price_per_night,
      accommodation: plan.priced.accommodation,
      housekeeping_fees: plan.priced.housekeeping_fees,
      beach_access_fees: plan.priced.beach_access_fees,
      utilities_amount: plan.priced.utilities_amount,
      insurance: plan.priced.insurance,
      promo: plan.promo,
      discount: plan.discount,
      total_amount: plan.total_amount,
      amount_paid: plan.amount_paid,
      amount_due: plan.amount_due,
      payment_status: plan.payment_status,
    },
  };
}

async function executeTransfer(reservationId, body, staffUser) {
  const source = await loadReservation(reservationId);
  const plan = await buildTransferPlan(source, body);
  const reason = String(body.reason || '').trim();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const transferNote = [
      `[transferred from #${source.id}]`,
      plan.unit.unit_number || plan.unit.title,
      reason ? `reason: ${reason}` : null,
      staffUser?.full_name ? `by ${staffUser.full_name}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const newNotes = [source.notes, transferNote].filter(Boolean).join('\n');

    const inserted = await client.query(
      `INSERT INTO reservations (
         unit_id, guest_name, guest_email, guest_phone, guest_nationality,
         check_in, check_out, nights, total_amount, amount_paid, payment_status,
         booking_source, sales_person_id, is_owner_reservation, status, notes, created_by,
         booking_id, price_per_night, housekeeping_fees, insurance, down_payment,
         utilities_amount, utilities_cost_override,
         broker_name, broker_amount_per_night, broker_total,
         owner_collected_type, owner_collected_amount,
         payment_method, transfer_proof_path, transfer_proof_name,
         hold_expires_at, adults, children, nanny_count, sales_label,
         beach_access_fees, id_photo_urls
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
         $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39
       )
       RETURNING *`,
      [
        plan.unit.id,
        source.guest_name,
        source.guest_email,
        source.guest_phone,
        source.guest_nationality,
        plan.check_in,
        plan.check_out,
        plan.priced.nights,
        plan.total_amount,
        plan.amount_paid,
        plan.payment_status,
        source.booking_source,
        source.sales_person_id,
        source.is_owner_reservation || 0,
        source.status,
        newNotes,
        source.created_by,
        source.booking_id,
        plan.priced.price_per_night,
        plan.priced.housekeeping_fees,
        plan.priced.insurance,
        source.down_payment,
        plan.priced.utilities_amount,
        source.utilities_cost_override,
        source.broker_name,
        source.broker_amount_per_night,
        source.broker_total,
        source.owner_collected_type,
        source.owner_collected_amount,
        source.payment_method,
        source.transfer_proof_path,
        source.transfer_proof_name,
        source.hold_expires_at,
        source.adults,
        source.children,
        source.nanny_count,
        source.sales_label,
        plan.priced.beach_access_fees,
        source.id_photo_urls || [],
      ]
    );
    const created = inserted.rows[0];

    await client.query(`UPDATE payments SET reservation_id = $1 WHERE reservation_id = $2`, [
      created.id,
      source.id,
    ]);
    await client.query(`UPDATE commissions SET reservation_id = $1 WHERE reservation_id = $2`, [
      created.id,
      source.id,
    ]).catch(() => {});
    await client.query(
      `UPDATE petty_cash SET linked_reservation_id = $1 WHERE linked_reservation_id = $2`,
      [created.id, source.id]
    ).catch(() => {});

    const cancelNote = [
      `[transferred to #${created.id} ${plan.unit.unit_number || plan.unit.title || ''}]`.trim(),
      reason ? `reason: ${reason}` : null,
    ]
      .filter(Boolean)
      .join(' · ');

    await client.query(
      `UPDATE reservations SET
         status = 'cancelled',
         notes = CASE
           WHEN notes IS NULL OR btrim(notes) = '' THEN $2
           ELSE notes || E'\n' || $2
         END,
         updated_at = now()
       WHERE id = $1`,
      [source.id, cancelNote]
    );

    await client.query(
      `UPDATE housekeeping_tasks
       SET status = 'cancelled', updated_at = now()
       WHERE reservation_id = $1 AND status IS DISTINCT FROM 'ready'`,
      [source.id]
    ).catch(() => {});

    if (source.booking_id) {
      await client.query(
        `UPDATE bookings SET
           unit_id = $2,
           listing_wp_id = $3,
           checkin = $4,
           checkout = $5,
           total_egp = $6,
           notes = CASE
             WHEN notes IS NULL OR btrim(notes) = '' THEN $7
             ELSE notes || E'\n' || $7
           END
         WHERE id = $1`,
        [
          source.booking_id,
          plan.unit.id,
          plan.unit.wp_post_id || null,
          plan.check_in,
          plan.check_out,
          plan.total_amount,
          `[transferred reservation #${source.id} → #${created.id}]`,
        ]
      );
    }

    if (plan.promo?.code) {
      const key = guestKeyFrom({
        email: source.guest_email,
        phone: source.guest_phone,
      });
      if (key) {
        await redeemPromo({
          code: plan.promo.code,
          email: source.guest_email,
          phone: source.guest_phone,
          bookingId: source.booking_id || null,
          amountBeforeDiscount: plan.priced.stay_before_promo,
          client,
          allowRepeat: true,
        });
      }
    }

    await client.query('COMMIT');

    try {
      const { syncBlocksForReservation } = require('./reservationBlocks');
      await syncBlocksForReservation({ ...source, status: 'cancelled' });
      await syncBlocksForReservation(created);
    } catch (err) {
      console.warn('[transferReservation] block sync failed', err.message);
    }

    await logAudit({
      userId: staffUser?.id,
      action: 'TRANSFER_RESERVATION',
      entityType: 'reservation',
      entityId: created.id,
      details: {
        from_id: source.id,
        to_id: created.id,
        from_unit_id: source.unit_id,
        to_unit_id: plan.unit.id,
        promo: plan.promo?.code || null,
        reason: reason || null,
      },
    });

    return { cancelled: { id: source.id, status: 'cancelled' }, reservation: created };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  previewTransfer,
  executeTransfer,
};
