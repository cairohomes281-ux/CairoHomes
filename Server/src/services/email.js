const { Resend } = require('resend');
const nodemailer = require('nodemailer');

function getResendClient() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey || apiKey.includes('xxxxxxxxx')) return null;
  return new Resend(apiKey);
}

function defaultFrom() {
  return (
    process.env.MAIL_FROM ||
    process.env.INQUIRY_FROM_EMAIL ||
    'Cairo Homes <onboarding@resend.dev>'
  );
}


async function sendEmail({ to, subject, html, text }) {
  const resend = getResendClient();

  if (resend) {
    const { data, error } = await resend.emails.send({
      from: defaultFrom(),
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    });
    if (error) {
      throw new Error(`Resend failed: ${error.message || JSON.stringify(error)}`);
    }
    return data;
  }

  if (!process.env.SMTP_HOST) {
    console.log('[email:dev]', { to, subject, text: text || html });
    return { id: 'dev-log' };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });

  return transporter.sendMail({
    from: defaultFrom(),
    to,
    subject,
    html,
    text,
  });
}

module.exports = { sendEmail, getResendClient, defaultFrom };
