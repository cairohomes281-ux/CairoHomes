const { query } = require('../config/db');

const AUTO_NOTE_PREFIX = 'auto_payroll_expense=';

function padMonth(month) {
  return String(month).padStart(2, '0');
}

function periodKey(year, month) {
  return `${year}-${padMonth(month)}`;
}

function lastDayOfPeriod(year, month) {
  const d = new Date(Date.UTC(Number(year), Number(month), 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function autoNote(year, month, staffId) {
  return `${AUTO_NOTE_PREFIX}${periodKey(year, month)} staff_id=${staffId}`;
}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function resolveSystemUserId() {
  const { rows } = await query(
    `SELECT id FROM staff_users
     WHERE role = 'admin' AND COALESCE(is_active, 1) = 1
     ORDER BY id ASC
     LIMIT 1`
  );
  if (rows[0]?.id) return rows[0].id;
  const { rows: any } = await query(`SELECT id FROM staff_users ORDER BY id ASC LIMIT 1`);
  return any[0]?.id || null;
}

/**
 * Post / refresh one salary expense from a paid payroll entry.
 * Amount = net pay (base + bonuses − deductions). Dated last day of the payroll month
 * so the cost lands in the correct financial period.
 */
async function postExpenseForPayrollEntry(entry, { staffName, createdBy } = {}) {
  const year = Number(entry.period_year);
  const month = Number(entry.period_month);
  const staffId = Number(entry.staff_user_id);
  const net = roundMoney(entry.net_pay);
  const base = roundMoney(entry.base_salary);
  const bonuses = roundMoney(entry.bonuses);
  const deductions = roundMoney(entry.deductions);

  if (!(net > 0.009) && !(base > 0.009 || bonuses > 0.009)) {
    return { action: 'skipped_zero', staff_id: staffId, amount: net };
  }

  const actor = createdBy || (await resolveSystemUserId());
  if (!actor) {
    return { action: 'error', error: 'No staff user to attribute expenses', staff_id: staffId };
  }

  const note = autoNote(year, month, staffId);
  const expenseDate = lastDayOfPeriod(year, month);
  const name = staffName || `Staff #${staffId}`;
  const description = `Payroll ${periodKey(year, month)} — ${name} (base ${base.toFixed(2)} + bonus ${bonuses.toFixed(2)} − ded ${deductions.toFixed(2)})`;

  const { rows: existing } = await query(
    `SELECT id FROM expenses WHERE category = 'salary' AND notes = $1 LIMIT 1`,
    [note]
  );

  if (existing[0]) {
    const { rows } = await query(
      `UPDATE expenses
       SET description = $1,
           amount = $2,
           expense_date = $3::date,
           paid_by = 'company',
           unit_id = NULL
       WHERE id = $4
       RETURNING id, amount, expense_date`,
      [description, net, expenseDate, existing[0].id]
    );
    return {
      action: 'updated',
      staff_id: staffId,
      expense_id: rows[0].id,
      amount: rows[0].amount,
      expense_date: rows[0].expense_date,
    };
  }

  const { rows } = await query(
    `INSERT INTO expenses (
       unit_id, description, amount, paid_by, expense_date, notes, created_by, category
     ) VALUES (
       NULL, $1, $2, 'company', $3::date, $4, $5, 'salary'
     )
     RETURNING id, amount, expense_date`,
    [description, net, expenseDate, note, actor]
  );

  return {
    action: 'created',
    staff_id: staffId,
    expense_id: rows[0].id,
    amount: rows[0].amount,
    expense_date: rows[0].expense_date,
  };
}

/**
 * Catch-up: post expenses for any paid payroll rows that are missing (or refresh amounts).
 */
async function syncPaidPayrollExpenses({ year, month } = {}) {
  const params = [];
  let filter = `p.status = 'paid'`;
  if (year != null && month != null) {
    params.push(Number(year), Number(month));
    filter += ` AND p.period_year = $1 AND p.period_month = $2`;
  }

  const { rows } = await query(
    `SELECT p.*, u.full_name, u.staff_code
     FROM staff_payroll_entries p
     JOIN staff_users u ON u.id = p.staff_user_id
     WHERE ${filter}
     ORDER BY p.period_year, p.period_month, p.staff_user_id`,
    params
  );

  const createdBy = await resolveSystemUserId();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const posted = [];

  for (const row of rows) {
    const name = row.full_name || row.staff_code || `Staff #${row.staff_user_id}`;
    const result = await postExpenseForPayrollEntry(row, { staffName: name, createdBy });
    if (result.action === 'created') created += 1;
    else if (result.action === 'updated') updated += 1;
    else skipped += 1;
    posted.push(result);
  }

  return { created, updated, skipped, count: rows.length, posted };
}

/** @deprecated Prefer payroll mark-paid → postExpenseForPayrollEntry */
async function postMonthlySalaryExpenses() {
  return syncPaidPayrollExpenses();
}

async function ensureCurrentMonthSalaryExpenses() {
  const now = new Date();
  return syncPaidPayrollExpenses({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
}

function startMonthlySalaryExpenseJob() {
  const interval = Number(process.env.SALARY_EXPENSE_INTERVAL_MS || 6 * 60 * 60 * 1000);

  const run = async () => {
    try {
      const result = await syncPaidPayrollExpenses();
      if (result.created > 0 || result.updated > 0) {
        console.log(
          `[salary-expenses] sync created=${result.created} updated=${result.updated} skipped=${result.skipped}`
        );
      }
    } catch (err) {
      console.error('[salary-expenses]', err.message);
    }
  };

  setTimeout(run, 20_000).unref?.();
  const timer = setInterval(run, interval);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  postExpenseForPayrollEntry,
  syncPaidPayrollExpenses,
  postMonthlySalaryExpenses,
  ensureCurrentMonthSalaryExpenses,
  startMonthlySalaryExpenseJob,
  AUTO_NOTE_PREFIX,
};
