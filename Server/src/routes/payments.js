const express = require('express');
const { query } = require('../config/db');
const { verifyPaymobHmac } = require('../config/paymob');

const router = express.Router();

router.post('/paymob-webhook', async (req, res, next) => {
  try {
    const hmac = req.query.hmac || req.headers['hmac'] || req.body.hmac;
    const body = req.body;
    const ok = verifyPaymobHmac(body, hmac);
    if (!ok) return res.status(401).json({ error: 'Invalid HMAC' });

    const obj = body.obj || body;
    const success = obj.success === true || obj.success === 'true';
    const merchantOrderId =
      obj.order?.merchant_order_id ||
      body.merchant_order_id ||
      obj.merchant_order_id;

    if (!merchantOrderId) return res.status(400).json({ error: 'Missing merchant_order_id' });

    const { rows: sessions } = await query(
      `SELECT * FROM card_checkout_sessions WHERE merchant_order_id = $1`,
      [merchantOrderId]
    );
    const session = sessions[0];
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (session.status === 'paid') return res.json({ ok: true, duplicate: true });

    if (!success) {
      await query(
        `UPDATE card_checkout_sessions SET status = 'failed', updated_at = now() WHERE id = $1`,
        [session.id]
      );
      return res.json({ ok: true, status: 'failed' });
    }

    const payload = typeof session.payload === 'string' ? JSON.parse(session.payload) : session.payload;

    const photoUrls = Array.isArray(payload.photo_urls) ? payload.photo_urls.filter(Boolean) : [];

    const adultCount = Math.max(
      1,
      parseInt(payload.adults, 10) || parseInt(payload.guests, 10) || 1
    );
    const childCount = Math.max(0, parseInt(payload.children ?? payload.teens, 10) || 0);
    const nannyCount = Math.max(0, parseInt(payload.nanny_count, 10) || 0);
    const guestTotal =
      Math.max(Number(payload.guests) || 0, adultCount + childCount + nannyCount) || adultCount;

    const { rows: bookings } = await query(
      `INSERT INTO bookings
        (listing_slug, listing_wp_id, listing_title, checkin, checkout, guests, total_egp,
         guest_name, guest_email, guest_phone, status, notes, currency, hold_expires_at,
         payment_status, payment_method, unit_id, id_photo_urls,
         adults, children, nanny_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,'EGP',NULL,'paid','paymob_card',$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        payload.slug,
        payload.listing_wp_id,
        payload.listing_title,
        payload.checkin,
        payload.checkout,
        guestTotal,
        payload.total_egp,
        payload.guest_name,
        payload.guest_email,
        payload.guest_phone,
        payload.notes || null,
        payload.unit_id,
        photoUrls,
        adultCount,
        childCount,
        nannyCount,
      ]
    );
    const booking = bookings[0];

    if (payload.promo_code) {
      try {
        const { redeemPromo } = require('../lib/promoCodes');
        await redeemPromo({
          code: payload.promo_code,
          email: payload.guest_email,
          phone: payload.guest_phone,
          guestId: payload.user_id,
          bookingId: booking.id,
          amountBeforeDiscount: payload.amount_before_promo || payload.total_egp,
        });
      } catch (promoErr) {
        console.warn('[payments] promo redeem failed', promoErr.message);
      }
    }

    await query(
      `INSERT INTO payments
        (booking_id, amount, payment_date, payment_method, status, transaction_reference, paid_at, is_approved)
       VALUES ($1,$2,CURRENT_DATE,'paymob_card','successful',$3,now(),1)`,
      [booking.id, payload.total_egp, String(obj.id || obj.order?.id || '')]
    );

    await query(
      `UPDATE card_checkout_sessions
       SET status = 'paid', booking_id = $1, updated_at = now()
       WHERE id = $2`,
      [booking.id, session.id]
    );

    
    try {
      const { assignSalesOnCreate } = require('../services/bookingWorkflow');
      await assignSalesOnCreate(booking.id);
    } catch (_) {}

    res.json({ ok: true, booking_id: booking.id });
  } catch (err) {
    next(err);
  }
});

router.get('/paymob-callback', async (req, res) => {
  
  const success = req.query.success === 'true';
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  res.redirect(`${frontend}/checkout/payment/callback?status=${success ? 'success' : 'failed'}`);
});

module.exports = router;
