const { query } = require('../../config/db');
const { round2 } = require('../commission');

const INSURANCE_REFUND_TRACKING_START = '2026-08-24';

function isoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function resolveStatus({ dueDate, paid, cancelled, today }) {
  if (cancelled) return 'cancelled';
  if (paid) return 'paid';
  if (dueDate && dueDate < today) return 'overdue';
  return 'pending';
}

async function ensureFinanceCalendarTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS public.finance_calendar_payments (
      id serial PRIMARY KEY,
      title varchar(255) NOT NULL,
      amount numeric(14, 2) NOT NULL DEFAULT 0,
      currency varchar(8) NOT NULL DEFAULT 'EGP',
      due_date date NOT NULL,
      direction varchar(8) NOT NULL DEFAULT 'out'
        CHECK (direction IN ('out', 'in')),
      category varchar(64),
      status varchar(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled')),
      paid_at timestamptz,
      notes text,
      account_code varchar(16),
      related_ref text,
      created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
      updated_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS finance_calendar_payments_due_date_idx
      ON public.finance_calendar_payments (due_date)
  `);
}

async function loadAccountingCalendarItems(from, to, today) {
  const items = [];

  try {
    const { rows } = await query(
      `SELECT vi.id, vi.invoice_number, vi.due_date::text AS due_date, vi.amount, vi.net_payable,
              vi.status, vi.paid_at, vi.description, vi.category,
              v.name AS vendor_name
       FROM vendor_invoices vi
       JOIN vendors v ON v.id = vi.vendor_id
       WHERE vi.due_date >= $1::date AND vi.due_date <= $2::date
       ORDER BY vi.due_date ASC, vi.id ASC`,
      [from, to]
    );
    for (const r of rows) {
      const status = resolveStatus({
        dueDate: r.due_date,
        paid: String(r.status).toLowerCase() === 'paid' || Boolean(r.paid_at),
        cancelled: String(r.status).toLowerCase() === 'rejected',
        today,
      });
      items.push({
        id: `ap:${r.id}`,
        source: 'accounting',
        source_type: 'vendor_invoice',
        source_id: r.id,
        title: r.invoice_number
          ? `AP · ${r.vendor_name} · ${r.invoice_number}`
          : `AP · ${r.vendor_name}`,
        amount: round2(parseFloat(r.net_payable != null ? r.net_payable : r.amount) || 0),
        currency: 'EGP',
        due_date: r.due_date,
        direction: 'out',
        category: r.category || 'vendor',
        status,
        account_code: null,
        related_ref: r.description || null,
        editable: false,
        meta: { vendor_name: r.vendor_name, invoice_status: r.status },
      });
    }
  } catch (err) {
    if (err?.code !== '42P01') throw err;
  }

  try {
    const { rows } = await query(
      `SELECT id, run_date::text AS due_date, total_net, total_amount, status, invoice_count, notes
       FROM payment_runs
       WHERE run_date >= $1::date AND run_date <= $2::date
       ORDER BY run_date ASC, id ASC`,
      [from, to]
    );
    for (const r of rows) {
      const st = String(r.status || '').toLowerCase();
      const status = resolveStatus({
        dueDate: r.due_date,
        paid: st === 'confirmed' || st === 'paid' || st === 'completed',
        cancelled: st === 'cancelled',
        today,
      });
      items.push({
        id: `run:${r.id}`,
        source: 'accounting',
        source_type: 'payment_run',
        source_id: r.id,
        title: `Payment run · ${r.invoice_count || 0} invoice(s)`,
        amount: round2(parseFloat(r.total_net != null ? r.total_net : r.total_amount) || 0),
        currency: 'EGP',
        due_date: r.due_date,
        direction: 'out',
        category: 'payment_run',
        status,
        account_code: null,
        related_ref: r.notes || null,
        editable: false,
        meta: { run_status: r.status },
      });
    }
  } catch (err) {
    if (err?.code !== '42P01') throw err;
  }

  try {
    const { rows } = await query(
      `SELECT kind, label, account_code, amount_egp, day_of_month
       FROM financial_recurring_charges
       WHERE is_active = 1 AND amount_egp > 0`
    );
    const fromDt = new Date(`${from}T00:00:00Z`);
    const toDt = new Date(`${to}T00:00:00Z`);
    for (let cursor = new Date(fromDt); cursor <= toDt; ) {
      const y = cursor.getUTCFullYear();
      const m = cursor.getUTCMonth();
      const dim = daysInMonth(y, m);
      for (const r of rows) {
        const day = Math.min(Number(r.day_of_month) || 1, dim);
        const due = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (due < from || due > to) continue;
        items.push({
          id: `recurring:${r.kind}:${due}`,
          source: 'accounting',
          source_type: 'recurring',
          source_id: r.kind,
          title: `Recurring · ${r.label}`,
          amount: round2(parseFloat(r.amount_egp) || 0),
          currency: 'EGP',
          due_date: due,
          direction: 'out',
          category: r.kind,
          status: resolveStatus({ dueDate: due, paid: false, cancelled: false, today }),
          account_code: r.account_code || null,
          related_ref: null,
          editable: false,
          meta: { kind: r.kind },
        });
      }
      cursor = new Date(Date.UTC(y, m + 1, 1));
    }
  } catch (err) {
    if (err?.code !== '42P01') throw err;
  }

  try {
    const { rows } = await query(
      `SELECT r.id, r.guest_name,
              to_char(r.check_out, 'YYYY-MM-DD') AS due_date,
              COALESCE(r.insurance, 0)::float AS amount,
              r.insurance_refund_status,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE COALESCE(r.insurance, 0) > 0.009
         AND LOWER(COALESCE(r.status::text, '')) <> 'cancelled'
         AND r.check_out::date >= $1::date
         AND r.check_out::date <= $2::date
         AND to_char(r.check_out, 'YYYY-MM-DD') >= $3
       ORDER BY r.check_out ASC`,
      [from, to, INSURANCE_REFUND_TRACKING_START]
    );
    for (const r of rows) {
      const st = String(r.insurance_refund_status || 'pending').toLowerCase();
      const paid = ['refunded', 'partial', 'forfeited'].includes(st);
      items.push({
        id: `insurance:${r.id}`,
        source: 'accounting',
        source_type: 'insurance_refund',
        source_id: r.id,
        title: `Insurance · ${r.guest_name || 'Guest'} · ${r.unit_name}`,
        amount: round2(parseFloat(r.amount) || 0),
        currency: 'EGP',
        due_date: r.due_date,
        direction: 'out',
        category: 'insurance',
        status: resolveStatus({
          dueDate: r.due_date,
          paid,
          cancelled: false,
          today,
        }),
        account_code: '204000',
        related_ref: `Reservation #${r.id}`,
        editable: false,
        meta: { insurance_refund_status: st },
      });
    }
  } catch (err) {
    if (err?.code !== '42P01') throw err;
  }

  try {
    const { rows } = await query(
      `SELECT a.id, a.action_type, a.notes, a.next_action_date::text AS due_date,
              a.reservation_id, r.guest_name,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
              GREATEST(0, COALESCE(r.total_amount, 0) - COALESCE(r.amount_paid, 0))::float AS amount_due
       FROM ar_collection_actions a
       JOIN reservations r ON r.id = a.reservation_id
       JOIN units u ON u.id = r.unit_id
       WHERE a.next_action_date IS NOT NULL
         AND a.next_action_date >= $1::date
         AND a.next_action_date <= $2::date
       ORDER BY a.next_action_date ASC`,
      [from, to]
    );
    for (const r of rows) {
      items.push({
        id: `ar_action:${r.id}`,
        source: 'accounting',
        source_type: 'ar_followup',
        source_id: r.id,
        title: `AR follow-up · ${r.guest_name || 'Guest'} · ${r.unit_name}`,
        amount: round2(parseFloat(r.amount_due) || 0),
        currency: 'EGP',
        due_date: r.due_date,
        direction: 'in',
        category: r.action_type || 'ar',
        status: resolveStatus({
          dueDate: r.due_date,
          paid: false,
          cancelled: false,
          today,
        }),
        account_code: '105000',
        related_ref: r.notes || `Reservation #${r.reservation_id}`,
        editable: false,
        meta: { reservation_id: r.reservation_id },
      });
    }
  } catch (err) {
    if (err?.code !== '42P01') throw err;
  }

  return items;
}

async function loadManualCalendarItems(from, to, today) {
  await ensureFinanceCalendarTable();
  const { rows } = await query(
    `SELECT c.*, creator.full_name AS created_by_name
     FROM finance_calendar_payments c
     LEFT JOIN staff_users creator ON creator.id = c.created_by
     WHERE c.due_date >= $1::date AND c.due_date <= $2::date
       AND c.status <> 'cancelled'
     ORDER BY c.due_date ASC, c.id ASC`,
    [from, to]
  );
  return rows.map((r) => {
    const due = String(r.due_date).slice(0, 10);
    const paid = String(r.status).toLowerCase() === 'paid' || Boolean(r.paid_at);
    return {
      id: `manual:${r.id}`,
      source: 'manual',
      source_type: 'manual',
      source_id: r.id,
      title: r.title,
      amount: round2(parseFloat(r.amount) || 0),
      currency: r.currency || 'EGP',
      due_date: due,
      direction: r.direction || 'out',
      category: r.category || 'other',
      status: resolveStatus({
        dueDate: due,
        paid,
        cancelled: String(r.status).toLowerCase() === 'cancelled',
        today,
      }),
      account_code: r.account_code || null,
      related_ref: r.related_ref || r.notes || null,
      notes: r.notes || null,
      editable: true,
      created_by_name: r.created_by_name || null,
      paid_at: r.paid_at || null,
      meta: {},
    };
  });
}

async function buildPaymentCalendar(fromRaw, toRaw) {
  const today = new Date().toISOString().slice(0, 10);
  const from = isoDate(fromRaw) || today;
  const to = isoDate(toRaw) || today;
  const [accounting, manual] = await Promise.all([
    loadAccountingCalendarItems(from, to, today),
    loadManualCalendarItems(from, to, today),
  ]);
  const items = [...accounting, ...manual].sort((a, b) => {
    const d = String(a.due_date).localeCompare(String(b.due_date));
    if (d !== 0) return d;
    return String(a.title).localeCompare(String(b.title));
  });

  const byStatus = { pending: 0, overdue: 0, paid: 0, cancelled: 0 };
  let amountPending = 0;
  let amountOverdue = 0;
  for (const it of items) {
    byStatus[it.status] = (byStatus[it.status] || 0) + 1;
    if (it.status === 'pending') amountPending += it.amount;
    if (it.status === 'overdue') amountOverdue += it.amount;
  }

  return {
    from,
    to,
    as_of: today,
    summary: {
      total: items.length,
      pending: byStatus.pending || 0,
      overdue: byStatus.overdue || 0,
      paid: byStatus.paid || 0,
      amount_pending: round2(amountPending),
      amount_overdue: round2(amountOverdue),
      accounting_count: accounting.length,
      manual_count: manual.length,
    },
    items,
  };
}

module.exports = {
  buildPaymentCalendar,
  ensureFinanceCalendarTable,
  isoDate,
  resolveStatus,
};
