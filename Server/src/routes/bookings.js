const express = require('express');
const { query } = require('../config/db');
const { quoteStay } = require('../services/pricing');
const { initializePaymobCheckout } = require('../config/paymob');
const { authGuest } = require('../middleware/auth');
const { isLongTermUnit } = require('../lib/listingType');
const { upload, attachCloudinaryUrls } = require('../config/cloudinary');

const router = express.Router();

function merchantOrderId() {
  return `TEMP_CH_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

router.post('/checkout', authGuest, upload.array('id_photos', 10), attachCloudinaryUrls, async (req, res, next) => {
  try {
    const {
      slug,
      checkin,
      checkout,
      guests,
      adults,
      teens,
      children,
      nanny_count,
      guest_name,
      guest_email,
      guest_phone,
      payment_method = 'paymob_card',
      notes,
      promo_code,
      callback_url,
    } = req.body;

    const { rows: units } = await query(`SELECT * FROM units WHERE slug = $1 AND status = 'published'`, [slug]);
    const unit = units[0];
    if (!unit) return res.status(404).json({ error: 'Listing not found' });
    if (isLongTermUnit(unit) || unit.disable_automatic_reservations) {
      return res.status(403).json({
        error: 'Online reservations are disabled for this unit. Please inquire on WhatsApp.',
      });
    }

    
    const teenCount = Math.max(0, parseInt(teens ?? children, 10) || 0);
    const nannyCount = Math.max(0, parseInt(nanny_count, 10) || 0);
    const adultCount = (() => {
      const explicit = parseInt(adults, 10);
      if (Number.isFinite(explicit) && explicit >= 1) return explicit;
      const guestTotal = parseInt(guests, 10);
      if (Number.isFinite(guestTotal) && guestTotal >= 1) {
        return Math.max(1, guestTotal - teenCount - nannyCount);
      }
      return 1;
    })();
    const guestTotal = Math.max(
      Number(guests) || 0,
      adultCount + teenCount + nannyCount
    );

    const quote = await quoteStay({
      wpPostId: unit.wp_post_id,
      checkin,
      checkout,
      unit,
      adults: adultCount,
      teens: teenCount,
    });
    if (!quote.available) return res.status(409).json({ error: quote.reason || 'Unavailable' });

    let total = quote.total_egp;
    let promoApplied = null;
    if (promo_code) {
      const { validatePromo } = require('../lib/promoCodes');
      try {
        promoApplied = await validatePromo({
          code: promo_code,
          amount: quote.total_egp,
          email: guest_email || req.guest?.email,
          phone: guest_phone,
          guestId: req.guest?.id,
        });
        total = promoApplied.discounted_total;
      } catch (promoErr) {
        return res.status(promoErr.status || 400).json({ error: promoErr.message });
      }
    }

    const photoUrls = (req.files || []).map((f) => f.path || f.secure_url).filter(Boolean);

    if (payment_method === 'paymob_card' || payment_method === 'card') {
      const orderId = merchantOrderId();
      const payload = {
        slug: unit.slug,
        unit_id: unit.id,
        listing_wp_id: unit.wp_post_id,
        listing_title: unit.title,
        checkin,
        checkout,
        guests: guestTotal,
        adults: adultCount,
        children: teenCount,
        nanny_count: nannyCount,
        guest_name,
        guest_email,
        guest_phone,
        total_egp: total,
        notes,
        photo_urls: photoUrls,
        user_id: req.guest?.id || null,
        promo_code: promoApplied?.code || null,
        amount_before_promo: quote.total_egp,
      };

      const paymob = await initializePaymobCheckout({
        amountEgp: total,
        merchantOrderId: orderId,
        billing: {
          email: guest_email,
          phone: guest_phone,
          firstName: String(guest_name || 'Guest').split(' ')[0],
          lastName: String(guest_name || 'Cairo Homes').split(' ').slice(1).join(' ') || 'Guest',
        },
      });

      await query(
        `INSERT INTO card_checkout_sessions
          (merchant_order_id, paymob_order_id, paymob_payment_key, amount_cents, currency, payload, payment_url, status)
         VALUES ($1,$2,$3,$4,'EGP',$5,$6,'pending')`,
        [orderId, paymob.paymobOrderId, paymob.paymentKey, paymob.amountCents, JSON.stringify(payload), paymob.checkoutUrl]
      );

      return res.json({
        mode: 'paymob',
        redirectToPaymob: true,
        checkoutUrl: paymob.checkoutUrl,
        merchantOrderId: orderId,
        callback_url: callback_url || `${process.env.FRONTEND_URL}/checkout/payment/callback`,
      });
    }

    
    
    const { rows } = await query(
      `INSERT INTO bookings
        (listing_slug, listing_wp_id, listing_title, checkin, checkout, guests, total_egp,
         guest_name, guest_email, guest_phone, status, notes, currency, hold_expires_at,
         payment_status, payment_method, unit_id, id_photo_urls,
         adults, children, nanny_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,'EGP',NULL,'pending',$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        unit.slug,
        unit.wp_post_id,
        unit.title,
        checkin,
        checkout,
        guestTotal,
        total,
        guest_name,
        guest_email,
        guest_phone,
        notes,
        payment_method,
        unit.id,
        photoUrls,
        adultCount,
        teenCount,
        nannyCount,
      ]
    );

    const booking = rows[0];
    if (promoApplied?.code) {
      try {
        const { redeemPromo } = require('../lib/promoCodes');
        await redeemPromo({
          code: promoApplied.code,
          email: guest_email || req.guest?.email,
          phone: guest_phone,
          guestId: req.guest?.id,
          bookingId: booking.id,
          amountBeforeDiscount: quote.total_egp,
        });
      } catch (promoErr) {
        await query(`UPDATE bookings SET status = 'cancelled', cancellation_reason = $2 WHERE id = $1`, [
          booking.id,
          promoErr.message || 'Promo code rejected',
        ]);
        return res.status(promoErr.status || 400).json({ error: promoErr.message });
      }
    }
    try {
      const { assignSalesOnCreate } = require('../services/bookingWorkflow');
      await assignSalesOnCreate(booking.id);
    } catch (_) {}

    res.status(201).json({ mode: 'hold', booking, message: 'Request received — awaiting confirmation' });
  } catch (err) {
    next(err);
  }
});

router.get('/mine', authGuest, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT b.*,
              u.unit_number,
              u.title AS unit_title,
              u.slug AS unit_slug,
              r.id AS reservation_id,
              CASE
                WHEN b.status = 'confirmed'
                 AND CURRENT_DATE >= b.checkin::date
                 AND CURRENT_DATE < b.checkout::date
                THEN true ELSE false
              END AS is_current_stay,
              (
                SELECT count(*)::int FROM housekeeping_tasks ht
                WHERE ht.booking_id = b.id AND ht.source = 'guest_request'
              ) AS guest_housekeeping_count,
              EXISTS (
                SELECT 1 FROM housekeeping_tasks ht
                WHERE ht.booking_id = b.id
                  AND ht.source = 'guest_request'
                  AND ht.status IN ('pending', 'accepted', 'in_progress', 'submitted', 'needs_reclean')
              ) AS has_pending_housekeeping
       FROM bookings b
       LEFT JOIN profiles p ON p.email = b.guest_email
       LEFT JOIN units u ON u.id = b.unit_id
       LEFT JOIN reservations r ON r.booking_id = b.id
       WHERE (p.id = $1 OR b.guest_email = $2)
         AND b.status <> 'cancelled'
       ORDER BY b.created_at DESC`,
      [req.guest.id, req.guest.email]
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});


router.post('/:id/housekeeping-request', authGuest, async (req, res, next) => {
  try {
    const timeLabel = String(req.body?.time || req.body?.requested_time || '').trim();
    const serviceDate = String(req.body?.date || req.body?.service_date || '')
      .trim()
      .slice(0, 10);

    const allowedTimes = [];
    for (let h = 3; h <= 23; h++) {
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      const suffix = h < 12 ? 'AM' : 'PM';
      allowedTimes.push(`${hour12}:00 ${suffix}`);
    }
    if (!allowedTimes.includes(timeLabel)) {
      return res.status(400).json({ error: 'Choose a time between 3:00 AM and 11:00 PM' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      return res.status(400).json({ error: 'A valid service date is required' });
    }

    const { rows: bookings } = await query(
      `SELECT b.*, u.unit_number, r.id AS reservation_id
       FROM bookings b
       LEFT JOIN profiles p ON p.email = b.guest_email
       LEFT JOIN units u ON u.id = b.unit_id
       LEFT JOIN reservations r ON r.booking_id = b.id
       WHERE b.id = $1
         AND (p.id = $2 OR b.guest_email = $3)
       LIMIT 1`,
      [req.params.id, req.guest.id, req.guest.email]
    );
    const booking = bookings[0];
    if (!booking) return res.status(404).json({ error: 'Reservation not found' });
    if (booking.status !== 'confirmed') {
      return res.status(400).json({ error: 'Only accepted reservations can request housekeeping' });
    }
    if (!booking.unit_id) {
      return res.status(400).json({ error: 'This reservation has no unit assigned' });
    }

    const { toIsoDate } = require('../services/pricing');
    const checkin = toIsoDate(booking.checkin);
    const checkout = toIsoDate(booking.checkout);
    if (!checkin || !checkout) {
      return res.status(400).json({ error: 'Reservation dates are invalid' });
    }
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (todayIso < checkin || todayIso >= checkout) {
      return res.status(400).json({
        error: 'Housekeeping can only be requested during your stay',
      });
    }
    if (serviceDate < checkin || serviceDate >= checkout) {
      return res.status(400).json({
        error: 'Pick a date within your reservation dates',
      });
    }

    const { rows: pendingRows } = await query(
      `SELECT id, status, requested_time
       FROM housekeeping_tasks
       WHERE booking_id = $1
         AND source = 'guest_request'
         AND status IN ('pending', 'accepted', 'in_progress', 'submitted', 'needs_reclean')
       ORDER BY created_at DESC
       LIMIT 1`,
      [booking.id]
    );
    if (pendingRows[0]) {
      return res.status(409).json({
        error:
          'You already have a housekeeping request in progress. Wait until it is completed before requesting another.',
        pending_task_id: pendingRows[0].id,
        pending_status: pendingRows[0].status,
        requested_time: pendingRows[0].requested_time,
      });
    }

    
    const m = timeLabel.match(/^(\d{1,2}):00\s*(AM|PM)$/i);
    let hour24 = Number(m[1]);
    const meridiem = m[2].toUpperCase();
    if (meridiem === 'AM') {
      if (hour24 === 12) hour24 = 0;
    } else if (hour24 !== 12) {
      hour24 += 12;
    }
    const dueAt = `${serviceDate}T${String(hour24).padStart(2, '0')}:00:00`;

    const { DEFAULT_CHECKLIST } = require('../jobs/housekeepingTasks');
    const note = [
      'Guest mid-stay housekeeping request',
      `Unit: ${booking.unit_number || booking.unit_id}`,
      `Requested time: ${timeLabel} on ${serviceDate}`,
      `Phone: ${booking.guest_phone || '—'}`,
    ].join('\n');

    const { rows } = await query(
      `INSERT INTO housekeeping_tasks (
         reservation_id, unit_id, booking_id, status, checklist, due_at,
         notes, source, requested_time
       ) VALUES ($1,$2,$3,'pending',$4::jsonb,$5::timestamptz,$6,'guest_request',$7)
       RETURNING *`,
      [
        booking.reservation_id || null,
        booking.unit_id,
        booking.id,
        JSON.stringify(DEFAULT_CHECKLIST),
        dueAt,
        note,
        `${serviceDate} ${timeLabel}`,
      ]
    );

    res.status(201).json({ ok: true, task: rows[0] });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const jwt = require('jsonwebtoken');
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token || !process.env.JWT_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { rows } = await query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    const booking = rows[0];
    if (!booking) return res.status(404).json({ error: 'Not found' });

    if (payload.kind === 'guest') {
      const guestEmail = String(payload.email || '')
        .trim()
        .toLowerCase();
      const owns =
        guestEmail &&
        String(booking.guest_email || '')
          .trim()
          .toLowerCase() === guestEmail;
      if (!owns) return res.status(403).json({ error: 'Forbidden' });
      return res.json({
        id: booking.id,
        status: booking.status,
        checkin: booking.checkin,
        checkout: booking.checkout,
        listing_title: booking.listing_title,
        listing_slug: booking.listing_slug,
        total_egp: booking.total_egp,
        payment_status: booking.payment_status,
        payment_method: booking.payment_method,
        guest_name: booking.guest_name,
        guest_email: booking.guest_email,
        guest_phone: booking.guest_phone,
        guests: booking.guests,
        adults: booking.adults,
        children: booking.children,
        nanny_count: booking.nanny_count,
        currency: booking.currency,
        created_at: booking.created_at,
      });
    }

    if (payload.kind === 'staff' || (!payload.kind && payload.role)) {
      return res.json(booking);
    }

    return res.status(401).json({ error: 'Unauthorized' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
