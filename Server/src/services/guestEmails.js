const { sendEmail } = require('./email');

function bookingReference(bookingOrId) {
  const id = typeof bookingOrId === 'string' ? bookingOrId : bookingOrId?.id;
  const raw = String(id || '')
    .replace(/-/g, '')
    .slice(0, 8)
    .toUpperCase();
  return raw ? `CH-${raw}` : 'CH-PENDING';
}

function moneyEgp(amount) {
  const n = Number(amount || 0);
  return `EGP ${n.toLocaleString('en-EG')}`;
}

async function sendBookingAcceptedEmail(booking) {
  const to = String(booking?.guest_email || '').trim();
  if (!to) {
    console.warn('[email] No guest email on booking — skip acceptance email');
    return null;
  }

  const reference = bookingReference(booking);
  const name = booking.guest_name || 'Guest';
  const phone = booking.guest_phone || '—';
  const total = moneyEgp(booking.total_egp);
  const checkin = booking.checkin;
  const checkout = booking.checkout;
  const title = booking.listing_title || 'your stay';

  const subject = `Reservation confirmed — ${reference}`;
  const text = [
    `Dear ${name},`,
    '',
    'Your reservation with Cairo Homes has been accepted.',
    '',
    `Reference code: ${reference}`,
    `Guest name: ${name}`,
    `Phone number: ${phone}`,
    `Total price: ${total}`,
    `Stay: ${checkin} → ${checkout}`,
    `Property: ${title}`,
    '',
    'We look forward to hosting you.',
    'Cairo Homes',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#2f5d58">
      <h1 style="font-size:22px;margin:0 0 12px">Reservation confirmed</h1>
      <p style="margin:0 0 16px;color:#5e7470">Dear ${escapeHtml(name)}, your stay request has been accepted.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#5e7470">Reference code</td><td style="padding:8px 0;font-weight:700">${escapeHtml(reference)}</td></tr>
        <tr><td style="padding:8px 0;color:#5e7470">Guest name</td><td style="padding:8px 0;font-weight:600">${escapeHtml(name)}</td></tr>
        <tr><td style="padding:8px 0;color:#5e7470">Phone number</td><td style="padding:8px 0;font-weight:600">${escapeHtml(phone)}</td></tr>
        <tr><td style="padding:8px 0;color:#5e7470">Total price</td><td style="padding:8px 0;font-weight:700">${escapeHtml(total)}</td></tr>
        <tr><td style="padding:8px 0;color:#5e7470">Check-in</td><td style="padding:8px 0">${escapeHtml(String(checkin || ''))}</td></tr>
        <tr><td style="padding:8px 0;color:#5e7470">Check-out</td><td style="padding:8px 0">${escapeHtml(String(checkout || ''))}</td></tr>
        <tr><td style="padding:8px 0;color:#5e7470">Property</td><td style="padding:8px 0">${escapeHtml(title)}</td></tr>
      </table>
      <p style="margin:24px 0 0;color:#5e7470;font-size:13px">Cairo Homes — we look forward to hosting you.</p>
    </div>
  `;

  return sendEmail({ to, subject, html, text });
}

async function sendPasswordResetEmail({ email, resetUrl, fullName }) {
  const to = String(email || '').trim();
  if (!to) return null;

  const name = fullName || 'Guest';
  const subject = 'Reset your Cairo Homes password';
  const text = [
    `Dear ${name},`,
    '',
    'We received a request to reset your Cairo Homes account password.',
    `Open this link to choose a new password (expires in 1 hour):`,
    resetUrl,
    '',
    'If you did not request this, you can ignore this email.',
    'Cairo Homes',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#2f5d58">
      <h1 style="font-size:22px;margin:0 0 12px">Reset your password</h1>
      <p style="margin:0 0 16px;color:#5e7470">Dear ${escapeHtml(name)}, we received a request to reset your account password.</p>
      <p style="margin:0 0 20px">
        <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#2f5d58;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600">
          Choose a new password
        </a>
      </p>
      <p style="margin:0;color:#5e7470;font-size:13px">This link expires in 1 hour. If you did not request a reset, ignore this email.</p>
    </div>
  `;

  return sendEmail({ to, subject, html, text });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  bookingReference,
  sendBookingAcceptedEmail,
  sendPasswordResetEmail,
};
