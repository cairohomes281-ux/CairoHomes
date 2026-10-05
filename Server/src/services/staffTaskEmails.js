const { sendEmail, getResendClient } = require('./email');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDeadline(value) {
  const iso = String(value || '').slice(0, 10);
  if (!iso) return '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isUsableStaffEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  if (email.endsWith('.local')) return '';
  return email;
}

function staffEmailFromUser(user) {
  return isUsableStaffEmail(user?.email) || isUsableStaffEmail(user?.username) || '';
}

function tasksPageUrl() {
  const base = String(process.env.ADMIN_URL || process.env.FRONTEND_URL || 'https://cairohomes-eg.com/admin').replace(
    /\/$/,
    ''
  );
  if (base.endsWith('/admin')) return `${base}/tasks`;
  return `${base}/admin/tasks`;
}

async function sendStaffTaskAssignedEmail({ to, assigneeName, managerName, title, description, deadline }) {
  const email = staffEmailFromUser({ email: to }) || isUsableStaffEmail(to);
  if (!email) {
    const err = new Error('This person has no email on Users');
    err.status = 400;
    throw err;
  }

  const name = assigneeName || 'there';
  const subject = `New task: ${title}`;
  const deadlineLabel = formatDeadline(deadline);
  const body = String(description || '').trim() || 'No description provided.';
  const openUrl = tasksPageUrl();

  const text = [
    `Hi ${name},`,
    '',
    `${managerName || 'Your manager'} assigned you a new task.`,
    '',
    `Title: ${title}`,
    `Deadline: ${deadlineLabel}`,
    '',
    body,
    '',
    `Open it here: ${openUrl}`,
    'Cairo Homes',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#2f5d58">
      <h1 style="font-size:22px;margin:0 0 12px">New task</h1>
      <p style="margin:0 0 16px;color:#5e7470">
        Hi ${escapeHtml(name)}, ${escapeHtml(managerName || 'your manager')} assigned you a new task.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr>
          <td style="padding:8px 0;color:#5e7470;vertical-align:top;width:110px">Title</td>
          <td style="padding:8px 0;font-weight:700">${escapeHtml(title)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#5e7470;vertical-align:top">Deadline</td>
          <td style="padding:8px 0;font-weight:600">${escapeHtml(deadlineLabel)}</td>
        </tr>
      </table>
      <p style="margin:16px 0 0;white-space:pre-wrap;line-height:1.5">${escapeHtml(body)}</p>
      <p style="margin:24px 0 0">
        <a href="${escapeHtml(openUrl)}" style="display:inline-block;background:#2f5d58;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">
          Open Tasks
        </a>
      </p>
      <p style="margin:24px 0 0;color:#5e7470;font-size:13px">Cairo Homes</p>
    </div>
  `;

  const result = await sendEmail({ to: email, subject, html, text });
  if (result?.id === 'dev-log' && !getResendClient() && !process.env.SMTP_HOST && process.env.NODE_ENV === 'production') {
    throw new Error('Email is not configured. Set RESEND_API_KEY or SMTP_HOST.');
  }
  return { ...result, to: email };
}

module.exports = { sendStaffTaskAssignedEmail, staffEmailFromUser, isUsableStaffEmail };
