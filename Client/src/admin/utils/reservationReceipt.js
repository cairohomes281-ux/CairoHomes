import { currency, formatDate, formatDateTime, nightsText, PAYMENT_METHOD_LABELS, unitDisplay } from './formatters';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return esc(currency(value));
}

function buildBillTotals(reservation) {
  const nights = Number(reservation.nights) || 0;
  const pricePerNight = parseFloat(reservation.price_per_night) || 0;
  const accommodation =
    pricePerNight > 0 && nights > 0
      ? Math.round(pricePerNight * nights * 100) / 100
      : 0;
  const storedTotal = parseFloat(reservation.total_amount) || 0;
  const hkFees = parseFloat(reservation.housekeeping_fees) || 0;
  const beachFees = parseFloat(reservation.beach_access_fees) || 0;
  const ins = parseFloat(reservation.insurance) || 0;
  const utilities = parseFloat(reservation.utilities_amount) || 0;
  const lineSum = Math.round((accommodation + hkFees + beachFees + ins + utilities) * 100) / 100;
  const total =
    accommodation > 0 && Math.abs(storedTotal - accommodation) <= 0.5
      ? lineSum
      : Math.max(storedTotal, lineSum);
  const amountPaid = parseFloat(reservation.amount_paid) || 0;
  const balance =
    reservation.amount_to_pay != null
      ? Math.max(0, parseFloat(reservation.amount_to_pay) || 0)
      : Math.max(0, Math.round((total - amountPaid) * 100) / 100);

  return {
    nights,
    pricePerNight,
    accommodation,
    storedTotal,
    hkFees,
    beachFees,
    ins,
    utilities,
    total,
    amountPaid,
    balance,
    downPayment: parseFloat(reservation.down_payment) || 0,
  };
}

function paymentRowsHtml(payments) {
  const list = Array.isArray(payments) ? payments : [];
  if (!list.length) {
    return `<tr><td colspan="5" class="muted">No payments recorded</td></tr>`;
  }
  return list
    .map((p) => {
      const method =
        PAYMENT_METHOD_LABELS?.[p.payment_method] ||
        p.payment_method ||
        p.method ||
        '—';
      const status = p.status || (p.is_approved ? 'approved' : 'pending');
      const when = p.payment_date || p.created_at;
      return `<tr>
        <td>${esc(formatDate(when))}</td>
        <td>${esc(method)}</td>
        <td class="num">${money(p.amount)}</td>
        <td>${esc(status)}</td>
        <td>${esc(p.notes || '')}</td>
      </tr>`;
    })
    .join('');
}

export function buildReservationReceiptHtml(reservation) {
  if (!reservation) return '';
  const bill = buildBillTotals(reservation);
  const generatedAt = formatDateTime(new Date().toISOString());
  const unit = unitDisplay(reservation) || reservation.unit_number || reservation.unit_name || '—';

  const lines = [
    bill.accommodation > 0 || bill.pricePerNight > 0
      ? `<tr><td>Accommodation${bill.nights ? ` (${esc(nightsText(bill.nights))})` : ''}${
          bill.pricePerNight > 0 ? ` · ${money(bill.pricePerNight)}/night` : ''
        }</td><td class="num">${money(bill.accommodation || bill.storedTotal)}</td></tr>`
      : `<tr><td>Stay total</td><td class="num">${money(bill.storedTotal)}</td></tr>`,
  ];
  if (bill.hkFees > 0) lines.push(`<tr><td>Housekeeping</td><td class="num">${money(bill.hkFees)}</td></tr>`);
  if (bill.beachFees > 0) lines.push(`<tr><td>Beach access</td><td class="num">${money(bill.beachFees)}</td></tr>`);
  if (bill.ins > 0) lines.push(`<tr><td>Insurance / deposit</td><td class="num">${money(bill.ins)}</td></tr>`);
  if (bill.utilities > 0) lines.push(`<tr><td>Utilities</td><td class="num">${money(bill.utilities)}</td></tr>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Receipt · Reservation #${esc(reservation.id)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", system-ui, sans-serif;
      color: #14213d;
      margin: 0;
      padding: 32px;
      background: #fff;
    }
    .sheet { max-width: 720px; margin: 0 auto; }
    .brand { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 2px solid #14213d; padding-bottom: 16px; }
    .brand h1 { margin: 0; font-size: 22px; letter-spacing: 0.04em; }
    .brand p { margin: 4px 0 0; color: #64748b; font-size: 12px; }
    .meta { text-align: right; font-size: 12px; color: #475569; }
    .meta strong { display: block; color: #14213d; font-size: 16px; margin-bottom: 4px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin: 28px 0 10px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; font-size: 13px; }
    .grid .label { color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    .grid .value { font-weight: 600; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
    th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    tfoot td { font-weight: 700; border-top: 2px solid #14213d; border-bottom: none; }
    .totals { margin-top: 8px; }
    .muted { color: #94a3b8; font-style: italic; }
    .footer { margin-top: 36px; padding-top: 12px; border-top: 1px dashed #cbd5e1; font-size: 11px; color: #64748b; }
    .actions { margin: 0 0 20px; display: flex; gap: 8px; }
    .actions button {
      border: 1px solid #cbd5e1; background: #14213d; color: #fff;
      border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer;
    }
    .actions button.secondary { background: #fff; color: #14213d; }
    @media print {
      body { padding: 0; }
      .actions { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="actions">
      <button type="button" onclick="window.print()">Print / Save PDF</button>
      <button type="button" class="secondary" onclick="window.close()">Close</button>
    </div>
    <div class="brand">
      <div>
        <h1>Cairo Homes</h1>
        <p>Reservation payment receipt</p>
      </div>
      <div class="meta">
        <strong>Receipt #${esc(reservation.id)}</strong>
        Generated ${esc(generatedAt)}
      </div>
    </div>

    <h2>Stay</h2>
    <div class="grid">
      <div><div class="label">Guest</div><div class="value">${esc(reservation.guest_name || '—')}</div></div>
      <div><div class="label">Unit</div><div class="value">${esc(unit)}</div></div>
      <div><div class="label">Check-in</div><div class="value">${esc(formatDate(reservation.check_in))}</div></div>
      <div><div class="label">Check-out</div><div class="value">${esc(formatDate(reservation.check_out))}</div></div>
      <div><div class="label">Nights</div><div class="value">${esc(nightsText(reservation.nights))}</div></div>
      <div><div class="label">Source</div><div class="value">${esc(reservation.booking_source || '—')}</div></div>
      <div><div class="label">Payment status</div><div class="value">${esc(reservation.payment_status || '—')}</div></div>
      <div><div class="label">Reservation status</div><div class="value">${esc(reservation.status || '—')}</div></div>
      <div><div class="label">Phone</div><div class="value">${esc(reservation.guest_phone || '—')}</div></div>
      <div><div class="label">Email</div><div class="value">${esc(reservation.guest_email || '—')}</div></div>
    </div>

    <h2>Charges</h2>
    <table class="totals">
      <thead><tr><th>Description</th><th class="num">Amount (EGP)</th></tr></thead>
      <tbody>${lines.join('')}</tbody>
      <tfoot>
        <tr><td>Total</td><td class="num">${money(bill.total)}</td></tr>
        <tr><td>Amount paid</td><td class="num">${money(bill.amountPaid)}</td></tr>
        <tr><td>Balance due</td><td class="num">${money(bill.balance)}</td></tr>
      </tfoot>
    </table>

    <h2>Payments</h2>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Method</th>
          <th class="num">Amount</th>
          <th>Status</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>${paymentRowsHtml(reservation.payments)}</tbody>
    </table>

    <div class="footer">
      Generated from Cairo Homes PMS · Reservation #${esc(reservation.id)}
      ${reservation.created_by_name ? ` · Created by ${esc(reservation.created_by_name)}` : ''}
    </div>
  </div>
</body>
</html>`;
}

/** Opens a printable receipt window for finance/admin. Returns false if popup blocked. */
export function openReservationReceipt(reservation) {
  if (!reservation?.id) return false;
  const html = buildReservationReceiptHtml(reservation);
  const win = window.open('', '_blank', 'noopener,noreferrer,width=860,height=1000');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  return true;
}
