const express = require('express');
const { query } = require('../config/db');
const { quoteStay } = require('../services/pricing');
const { sendEmail } = require('../services/email');
const { optionalGuest } = require('../middleware/auth');

const router = express.Router();

router.post('/', optionalGuest, async (req, res, next) => {
  try {
    const {
      listing_slug,
      checkin,
      checkout,
      guests,
      guest_name,
      guest_email,
      guest_phone,
      message,
      is_broker_request,
      end_guest_name,
      end_guest_phone,
      locale,
    } = req.body;

    const { rows: units } = await query(`SELECT * FROM units WHERE slug = $1`, [listing_slug]);
    const unit = units[0];
    if (!unit) return res.status(404).json({ error: 'Listing not found' });

    let price_per_night = null;
    let total_egp = null;
    let nights = null;
    try {
      const quote = await quoteStay({
        wpPostId: unit.wp_post_id,
        checkin,
        checkout,
        unit,
      });
      if (quote.available) {
        nights = quote.nights;
        total_egp = quote.total_egp;
        price_per_night = Math.round(quote.subtotal / quote.nights);
      }
    } catch {}

    if (!nights) {
      const a = new Date(checkin);
      const b = new Date(checkout);
      nights = Math.max(1, Math.round((b - a) / 86400000));
    }

    const { rows } = await query(
      `INSERT INTO inquiries
        (listing_slug, listing_wp_id, listing_title, area, checkin, checkout, nights, guests,
         price_per_night, total_egp, guest_name, guest_email, guest_phone, message,
         user_id, is_broker_request, end_guest_name, end_guest_phone, locale, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'website')
       RETURNING *`,
      [
        unit.slug,
        unit.wp_post_id,
        unit.title,
        unit.area,
        checkin,
        checkout,
        nights,
        Number(guests),
        price_per_night,
        total_egp,
        guest_name,
        guest_email,
        guest_phone,
        message || null,
        req.guest?.id || null,
        Boolean(is_broker_request),
        end_guest_name || null,
        end_guest_phone || null,
        locale || 'en',
      ]
    );

    const inquiry = rows[0];
    const to = process.env.INQUIRY_TO_EMAIL;
    if (to) {
      await sendEmail({
        to,
        subject: `Inquiry: ${unit.title} (${checkin} → ${checkout})`,
        text: `${guest_name} (${guest_phone}) inquired about ${unit.title}\n${message || ''}`,
        html: `<p><strong>${guest_name}</strong> (${guest_phone}) inquired about <em>${unit.title}</em></p>
               <p>${checkin} → ${checkout}, ${guests} guests</p>
               <p>${message || ''}</p>`,
      }).catch((e) => console.warn('[inquiry email]', e.message));
    }

    res.status(201).json(inquiry);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
