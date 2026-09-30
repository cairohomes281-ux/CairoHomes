
const { query } = require('../config/db');
const { sendCheckoutFeedbackWhatsApp } = require('../services/guestWhatsApp');
const { whatsappConfigured } = require('../services/whatsapp');

async function runCheckoutFeedbackWhatsApp() {
  if (!whatsappConfigured()) {
    return { sent: 0, skipped: 'not_configured' };
  }

  
  const { rows } = await query(
    `SELECT r.id,
            r.guest_name,
            r.guest_phone,
            COALESCE(u.title, u.unit_number, 'your stay') AS listing_title,
            u.slug
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     WHERE r.check_out::date = (timezone('Africa/Cairo', now()))::date - 1
       AND r.status IS DISTINCT FROM 'cancelled'
       AND COALESCE(r.guest_phone, '') <> ''
       AND NOT EXISTS (
         SELECT 1 FROM whatsapp_outbound_log w
         WHERE w.kind = 'checkout_feedback'
           AND w.entity_type = 'reservation'
           AND w.entity_id = r.id::text
           AND w.status = 'sent'
       )
     ORDER BY r.id ASC
     LIMIT 200`
  );

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await sendCheckoutFeedbackWhatsApp(row);
      if (result?.ok) sent += 1;
    } catch (err) {
      failed += 1;
      console.error('[whatsapp checkout]', row.id, err.message);
    }
  }
  return { sent, failed, candidates: rows.length };
}

module.exports = { runCheckoutFeedbackWhatsApp };
