
const { query } = require('../config/db');
const { bookingReference } = require('./guestEmails');
const { sendWhatsAppTemplate, whatsappConfigured, toWhatsAppRecipient } = require('./whatsapp');

function siteBaseUrl() {
  return String(process.env.FRONTEND_URL || 'https://cairohomes.com').replace(/\/$/, '');
}

function formatStayDate(value) {
  if (!value) return '—';
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return s.slice(0, 10);
  }
}

async function alreadySent(kind, entityType, entityId) {
  const { rows } = await query(
    `SELECT id FROM whatsapp_outbound_log
     WHERE kind = $1 AND entity_type = $2 AND entity_id = $3 AND status = 'sent'
     LIMIT 1`,
    [kind, entityType, String(entityId)]
  );
  return Boolean(rows[0]);
}

async function recordSend({ kind, entityType, entityId, phone, status, errorMessage, providerMessageId }) {
  try {
    await query(
      `INSERT INTO whatsapp_outbound_log (
         kind, entity_type, entity_id, phone, status, error_message, provider_message_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (kind, entity_type, entity_id) DO UPDATE SET
         phone = EXCLUDED.phone,
         status = EXCLUDED.status,
         error_message = EXCLUDED.error_message,
         provider_message_id = EXCLUDED.provider_message_id,
         created_at = now()`,
      [
        kind,
        entityType,
        String(entityId),
        phone || null,
        status,
        errorMessage || null,
        providerMessageId || null,
      ]
    );
  } catch (err) {
    console.error('[whatsapp] log insert failed:', err.message);
  }
}

async function sendBookingAcceptedWhatsApp(booking) {
  if (!whatsappConfigured()) return { skipped: true, reason: 'not_configured' };

  const phone = booking?.guest_phone;
  if (!toWhatsAppRecipient(phone)) {
    console.warn('[whatsapp] No usable guest phone on booking — skip acceptance WA');
    return { skipped: true, reason: 'invalid_phone' };
  }

  const entityId = booking.id;
  if (await alreadySent('booking_accepted', 'booking', entityId)) {
    return { skipped: true, reason: 'already_sent' };
  }

  const templateName =
    process.env.WHATSAPP_TEMPLATE_BOOKING_ACCEPTED || 'booking_accepted';
  const name = booking.guest_name || 'Guest';
  const title = booking.listing_title || 'your stay';
  const checkin = formatStayDate(booking.checkin);
  const checkout = formatStayDate(booking.checkout);
  const reference = bookingReference(booking);

  try {
    const result = await sendWhatsAppTemplate({
      to: phone,
      templateName,
      bodyParams: [name, title, checkin, checkout, reference],
    });
    if (result.skipped) return result;

    await recordSend({
      kind: 'booking_accepted',
      entityType: 'booking',
      entityId,
      phone: result.recipient,
      status: 'sent',
      providerMessageId: result.messageId,
    });
    return result;
  } catch (err) {
    await recordSend({
      kind: 'booking_accepted',
      entityType: 'booking',
      entityId,
      phone: toWhatsAppRecipient(phone),
      status: 'failed',
      errorMessage: err.message,
    });
    throw err;
  }
}

async function sendCheckoutFeedbackWhatsApp(reservation) {
  if (!whatsappConfigured()) return { skipped: true, reason: 'not_configured' };

  const phone = reservation?.guest_phone;
  if (!toWhatsAppRecipient(phone)) {
    return { skipped: true, reason: 'invalid_phone' };
  }

  const entityId = reservation.id;
  if (await alreadySent('checkout_feedback', 'reservation', entityId)) {
    return { skipped: true, reason: 'already_sent' };
  }

  const templateName =
    process.env.WHATSAPP_TEMPLATE_CHECKOUT_FEEDBACK || 'checkout_feedback';
  const name = reservation.guest_name || 'Guest';
  const title = reservation.listing_title || reservation.unit_title || 'your stay';
  const slug = reservation.slug || reservation.listing_slug;
  const reviewUrl = slug
    ? `${siteBaseUrl()}/listings/${slug}`
    : `${siteBaseUrl()}/`;

  try {
    const result = await sendWhatsAppTemplate({
      to: phone,
      templateName,
      bodyParams: [name, title, reviewUrl],
    });
    if (result.skipped) return result;

    await recordSend({
      kind: 'checkout_feedback',
      entityType: 'reservation',
      entityId,
      phone: result.recipient,
      status: 'sent',
      providerMessageId: result.messageId,
    });
    return result;
  } catch (err) {
    await recordSend({
      kind: 'checkout_feedback',
      entityType: 'reservation',
      entityId,
      phone: toWhatsAppRecipient(phone),
      status: 'failed',
      errorMessage: err.message,
    });
    throw err;
  }
}

module.exports = {
  sendBookingAcceptedWhatsApp,
  sendCheckoutFeedbackWhatsApp,
};
