
const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { clampFromDate, FINANCIAL_EPOCH } = require('../../lib/financialEpoch');
const { calcReservationFinancials, round2 } = require('../../lib/commission');
const { isWebsiteOriginReservation } = require('../../lib/reservationScope');
const {
  CHART_OF_ACCOUNTS,
  EXPENSE_CATEGORY_TO_ACCOUNT,
  accountsByGroup,
  getAccount,
} = require('../../lib/finance/chartOfAccounts');
const {
  outputVatOnCommission,
  withholdingTax,
  bookingSplit,
  monthlyTaxLiability,
  VAT_OUTPUT_PCT,
} = require('../../lib/finance/taxEngine');
const {
  buildFinancialPortal,
  buildYtdStatements,
  buildStatements,
  buildJournal,
  loadPortalData,
  mirrorTransactions,
  accountLabel,
  lastDayOfMonth,
  isPeriodClosed,
  vatReturn,
  agingFromReservations,
  ownerTrustSubledger,
  closeMonthEntry,
  buildCashFlowStatement,
} = require('../../lib/finance/ledgerEngine');
const { buildFinancialWorkbook, workbookToBuffer } = require('../../lib/finance/financialExport');
const {
  CREATED,
  runWithPeriodBasis,
  currentPeriodBasis,
  reservationPeriodSql,
} = require('../../lib/finance/periodBasis');

const router = express.Router();

const MANUAL_ENTRY_TYPES = new Set(['revenue', 'expense', 'journal']);

function resolveManualJournalLines(row) {
  const amt = parseFloat(row.amount) || 0;
  const debitCode = String(row.debit_account_code || '').trim();
  const creditCode = String(row.credit_account_code || '').trim();
  if (debitCode && creditCode && getAccount(debitCode) && getAccount(creditCode)) {
    return {
      type: row.entry_type === 'journal' ? 'manual_journal' : row.entry_type === 'revenue' ? 'manual_revenue' : row.entry_type === 'expense' ? 'manual_expense' : 'manual',
      lines: [
        journalLine(debitCode, amt, 0, row.description || row.notes || 'Manual journal debit'),
        journalLine(creditCode, 0, amt, row.description || row.notes || 'Manual journal credit'),
      ],
    };
  }
  if (row.entry_type === 'revenue') {
    return {
      type: 'manual_revenue',
      lines: [
        journalLine('101000', amt, 0, 'Manual revenue received'),
        journalLine('409000', 0, amt, row.description),
      ],
    };
  }
  if (row.entry_type === 'expense') {
    return {
      type: 'manual_expense',
      lines: [
        journalLine('503000', amt, 0, row.description),
        journalLine('201000', 0, amt, 'Manual expense paid'),
      ],
    };
  }
  if (row.misc_flow === 'out') {
    return {
      type: 'miscellaneous',
      lines: [
        journalLine('503000', amt, 0, row.description),
        journalLine('101000', 0, amt, 'Miscellaneous expense'),
      ],
    };
  }
  return {
    type: 'miscellaneous',
    lines: [
      journalLine('101000', amt, 0, 'Miscellaneous income'),
      journalLine('409000', 0, amt, row.description),
    ],
  };
}

async function assertPeriodOpen(date) {
  if (await isPeriodClosed(date)) {
    const err = new Error(`Books are closed for ${String(date).slice(0, 7)}`);
    err.status = 400;
    throw err;
  }
}

router.use('/financial-system', (req, _res, next) => runWithPeriodBasis(req.query.basis, next));

function dateRange(req) {
  const from = clampFromDate(req.query.from_date);
  const to = req.query.to_date || null;
  const params = [from];
  // Reservations fall into a period by check-in (default) or created date; other ledger sources by created date.
  const period = reservationPeriodSql('r');
  let resSql = `r.status <> 'cancelled' AND ${period} >= $1::date`;
  if (to) {
    params.push(to);
    resSql += ` AND ${period} <= $${params.length}::date`;
  }
  return { from, to, params, resSql };
}

async function computeOwnerPeriodBalance(ownerId, from, to) {
  const { rows: links } = await query(`SELECT unit_id FROM owner_units WHERE owner_id = $1`, [
    ownerId,
  ]);
  const unitIds = links.map((r) => r.unit_id);
  if (!unitIds.length) {
    return {
      owner_id: ownerId,
      unit_count: 0,
      gross_credits: 0,
      maintenance_deductions: 0,
      paid_out: 0,
      earned: 0,
      remaining: 0,
    };
  }

  const period = reservationPeriodSql('r');
  const resParams = [unitIds, from];
  let resSql = `r.unit_id = ANY($1::uuid[])
       AND r.status <> 'cancelled'
       AND ${period} >= $2::date`;
  if (to) {
    resParams.push(to);
    resSql += ` AND ${period} <= $3::date`;
  }
  const { rows: resRows } = await query(
    `SELECT r.nights, r.price_per_night, r.total_amount,
            r.broker_total, r.broker_amount_per_night,
            r.insurance, r.beach_access_fees, r.is_owner_reservation, r.status
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     WHERE ${resSql}`,
    resParams
  );

  let grossCredits = 0;
  for (const r of resRows) {
    const fin = calcReservationFinancials(r, r);
    grossCredits += Number(fin.ownerNet) || 0;
  }

  const expParams = [unitIds, from, ownerId];
  let expWhere = `paid_by = 'owner'
       AND created_at::date >= $2::date
       AND (
         owner_id = $3
         OR (owner_id IS NULL AND unit_id = ANY($1::uuid[]))
       )`;
  if (to) {
    expParams.push(to);
    expWhere += ` AND created_at::date <= $4::date`;
  }
  const { rows: expRows } = await query(
    `SELECT COALESCE(SUM(amount), 0)::float AS total FROM expenses WHERE ${expWhere}`,
    expParams
  );
  const maintenance = Number(expRows[0]?.total) || 0;

  const payParams = [ownerId, from];
  let payWhere = `owner_id = $1 AND status = 'paid' AND COALESCE(reviewed_at, created_at)::date >= $2::date`;
  if (to) {
    payParams.push(to);
    payWhere += ` AND COALESCE(reviewed_at, created_at)::date <= $3::date`;
  }
  let paidOut = 0;
  try {
    const { rows: payRows } = await query(
      `SELECT COALESCE(SUM(amount), 0)::float AS total
       FROM owner_payout_requests
       WHERE ${payWhere}`,
      payParams
    );
    paidOut = Number(payRows[0]?.total) || 0;
  } catch (_) {
    paidOut = 0;
  }

  const earned = round2(grossCredits - maintenance);
  return {
    owner_id: ownerId,
    unit_count: unitIds.length,
    gross_credits: round2(grossCredits),
    maintenance_deductions: round2(maintenance),
    paid_out: round2(paidOut),
    earned,
    remaining: round2(Math.max(0, earned - paidOut)),
  };
}

/**
 * One-pass load for owner statements / settle-by-owner (avoids N+1 per unit/owner).
 */
async function loadOwnerStatementData(from, to, unitId = null) {
  const period = reservationPeriodSql('r');
  const resParams = [from];
  let resWhere = `r.status <> 'cancelled' AND ${period} >= $1::date`;
  if (to) {
    resParams.push(to);
    resWhere += ` AND ${period} <= $${resParams.length}::date`;
  }
  if (unitId) {
    resParams.push(unitId);
    resWhere += ` AND r.unit_id = $${resParams.length}`;
  }

  const { rows: reservations } = await query(
    `SELECT r.id, r.unit_id, r.nights, r.price_per_night, r.total_amount,
            r.broker_total, r.broker_amount_per_night,
            r.insurance, r.beach_access_fees,
            r.is_owner_reservation, r.status,
            COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
            COALESCE(u.project, u.compound) AS project
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     WHERE ${resWhere}`,
    resParams
  );

  const unitIds = [...new Set(reservations.map((r) => r.unit_id).filter(Boolean))];

  const { rows: ownerLinks } = await query(
    `SELECT ou.unit_id, ou.owner_id, su.full_name
     FROM owner_units ou
     JOIN staff_users su ON su.id = ou.owner_id
     WHERE su.role = 'owner'
       ${unitIds.length ? 'AND ou.unit_id = ANY($1::uuid[])' : 'AND FALSE'}`,
    unitIds.length ? [unitIds] : []
  );

  const ownersByUnit = new Map();
  const unitsByOwner = new Map();
  const ownerName = new Map();
  for (const link of ownerLinks) {
    if (!ownersByUnit.has(link.unit_id)) ownersByUnit.set(link.unit_id, []);
    ownersByUnit.get(link.unit_id).push({ id: link.owner_id, full_name: link.full_name });
    if (!unitsByOwner.has(link.owner_id)) unitsByOwner.set(link.owner_id, new Set());
    unitsByOwner.get(link.owner_id).add(link.unit_id);
    ownerName.set(link.owner_id, link.full_name);
  }

  const unitCredits = new Map();
  const unitMeta = new Map();
  const ownerCredits = new Map();

  for (const r of reservations) {
    const fin = calcReservationFinancials(r, r);
    const ownerNet = Number(fin.ownerNet) || 0;
    unitCredits.set(r.unit_id, (unitCredits.get(r.unit_id) || 0) + ownerNet);
    if (!unitMeta.has(r.unit_id)) {
      unitMeta.set(r.unit_id, {
        unit_id: r.unit_id,
        unit_name: r.unit_name,
        project: r.project,
        reservation_count: 0,
      });
    }
    unitMeta.get(r.unit_id).reservation_count += 1;

    const owners = ownersByUnit.get(r.unit_id) || [];
    if (!owners.length) continue;
    // Split unit owner-net evenly across linked owners for the period rollup.
    const share = ownerNet / owners.length;
    for (const o of owners) {
      ownerCredits.set(o.id, (ownerCredits.get(o.id) || 0) + share);
    }
  }

  const expParams = [from];
  let expWhere = `paid_by = 'owner' AND created_at::date >= $1::date`;
  if (to) {
    expParams.push(to);
    expWhere += ` AND created_at::date <= $${expParams.length}::date`;
  }
  if (unitId) {
    expParams.push(unitId);
    expWhere += ` AND unit_id = $${expParams.length}`;
  } else if (unitIds.length) {
    expParams.push(unitIds);
    expWhere += ` AND unit_id = ANY($${expParams.length}::uuid[])`;
  } else {
    expWhere += ` AND FALSE`;
  }

  let expenses = [];
  try {
    const { rows } = await query(
      `SELECT unit_id, owner_id, amount FROM expenses WHERE ${expWhere}`,
      expParams
    );
    expenses = rows;
  } catch (_) {
    expenses = [];
  }

  const unitExpenses = new Map();
  const ownerExpenses = new Map();
  for (const e of expenses) {
    const amt = Number(e.amount) || 0;
    if (e.unit_id) {
      unitExpenses.set(e.unit_id, (unitExpenses.get(e.unit_id) || 0) + amt);
    }
    if (e.owner_id) {
      ownerExpenses.set(e.owner_id, (ownerExpenses.get(e.owner_id) || 0) + amt);
    } else if (e.unit_id) {
      const owners = ownersByUnit.get(e.unit_id) || [];
      if (!owners.length) continue;
      const share = amt / owners.length;
      for (const o of owners) {
        ownerExpenses.set(o.id, (ownerExpenses.get(o.id) || 0) + share);
      }
    }
  }

  const payParams = [from];
  let payWhere = `status = 'paid' AND COALESCE(reviewed_at, created_at)::date >= $1::date`;
  if (to) {
    payParams.push(to);
    payWhere += ` AND COALESCE(reviewed_at, created_at)::date <= $${payParams.length}::date`;
  }
  const paidByOwner = new Map();
  try {
    const { rows: payRows } = await query(
      `SELECT owner_id, COALESCE(SUM(amount), 0)::float AS total
       FROM owner_payout_requests
       WHERE ${payWhere}
       GROUP BY owner_id`,
      payParams
    );
    for (const p of payRows) {
      paidByOwner.set(p.owner_id, Number(p.total) || 0);
    }
  } catch (_) {}

  const statements = [...unitMeta.values()]
    .map((u) => {
      const gross = round2(unitCredits.get(u.unit_id) || 0);
      const maintenance = round2(unitExpenses.get(u.unit_id) || 0);
      const owners = ownersByUnit.get(u.unit_id) || [];
      return {
        unit_id: u.unit_id,
        unit_name: u.unit_name,
        project: u.project,
        owners,
        owner_names: owners.map((o) => o.full_name).join(', ') || '—',
        reservation_count: u.reservation_count,
        gross_credits: gross,
        maintenance_deductions: maintenance,
        net_payout_due: round2(gross - maintenance),
      };
    })
    .sort((a, b) => {
      const byProject = String(a.project || '').localeCompare(String(b.project || ''));
      if (byProject !== 0) return byProject;
      return String(a.unit_name || '').localeCompare(String(b.unit_name || ''));
    });

  const ownerIds = new Set([
    ...ownerCredits.keys(),
    ...ownerExpenses.keys(),
    ...paidByOwner.keys(),
  ]);
  // When filtering by unit, only owners linked to that unit.
  if (unitId) {
    const allowed = new Set((ownersByUnit.get(unitId) || []).map((o) => o.id));
    for (const id of [...ownerIds]) {
      if (!allowed.has(id)) ownerIds.delete(id);
    }
  }

  const ownerBalances = [];
  for (const oid of ownerIds) {
    const gross = round2(ownerCredits.get(oid) || 0);
    const maintenance = round2(ownerExpenses.get(oid) || 0);
    const paidOut = round2(paidByOwner.get(oid) || 0);
    const earned = round2(gross - maintenance);
    const remaining = round2(Math.max(0, earned - paidOut));
    if (earned <= 0.009 && paidOut <= 0.009 && remaining <= 0.009) continue;
    ownerBalances.push({
      owner_id: oid,
      full_name: ownerName.get(oid) || `Owner #${oid}`,
      unit_count: (unitsByOwner.get(oid) || new Set()).size,
      gross_credits: gross,
      maintenance_deductions: maintenance,
      paid_out: paidOut,
      earned,
      remaining,
    });
  }
  ownerBalances.sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));

  return { statements, ownerBalances };
}

async function loadReservations(req) {
  const { params, resSql } = dateRange(req);
  const unitId = req.query.unit_id ? String(req.query.unit_id).trim() : '';
  const ownerId = req.query.owner_id ? String(req.query.owner_id).trim() : '';
  const extraParams = [...params];
  let joinSql = '';
  let filterSql = '';

  if (unitId) {
    extraParams.push(unitId);
    filterSql += ` AND r.unit_id = $${extraParams.length}`;
  }
  if (ownerId) {
    extraParams.push(ownerId);
    joinSql = ` JOIN owner_units ou ON ou.unit_id = r.unit_id AND ou.owner_id = $${extraParams.length}`;
  }

  const { rows } = await query(
    `SELECT r.*,
            COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
            COALESCE(u.project, u.compound) AS project,
            COALESCE(sp.full_name, '—') AS sales_person_name,
            COALESCE(sp.sales_commission_pct, 0) AS agent_commission_pct
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     ${joinSql}
     LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
     WHERE ${resSql}${filterSql}
     ORDER BY r.created_at DESC`,
    extraParams
  );
  return rows;
}

function journalLine(account, debit, credit, memo) {
  return {
    account,
    account_name: accountLabel(account),
    debit,
    credit,
    memo,
  };
}

async function loadManualEntries(from, to) {
  const params = [from];
  let where = 'm.created_at::date >= $1::date';
  if (to) {
    params.push(to);
    where += ` AND m.created_at::date <= $${params.length}::date`;
  }
  try {
    const { rows } = await query(
      `SELECT m.*,
              COALESCE(u.unit_number, u.title) AS unit_name,
              su.full_name AS created_by_name
       FROM financial_manual_entries m
       LEFT JOIN units u ON u.id = m.unit_id
       LEFT JOIN staff_users su ON su.id = m.created_by
       WHERE ${where}
       ORDER BY m.created_at DESC, m.entry_date DESC`,
      params
    );
    return rows;
  } catch (e) {
    if (e.code === '42P01') return [];
    throw e;
  }
}

function summarizeManualEntries(entries) {
  let revenue = 0;
  let expense = 0;
  let miscIn = 0;
  let miscOut = 0;
  for (const e of entries) {
    const amt = parseFloat(e.amount) || 0;
    if (e.entry_type === 'revenue') revenue += amt;
    else if (e.entry_type === 'expense') expense += amt;
    else if (e.misc_flow === 'out') miscOut += amt;
    else miscIn += amt;
  }
  return {
    revenue: round2(revenue),
    expense: round2(expense),
    misc_in: round2(miscIn),
    misc_out: round2(miscOut),
    misc_net: round2(miscIn - miscOut),
  };
}

function manualJournalEntry(row) {
  const ref = `MAN-${row.id}`;
  const { type, lines } = resolveManualJournalLines(row);
  return {
    id: ref,
    date: row.entry_date,
    type,
    reference: ref,
    description: row.description || row.notes || 'Manual journal',
    lines,
  };
}

function reservationJournalEntry(r, fin, split) {
  const ref = `RES-${r.id}`;
  const lines = [];
  const guestTotal = round2(parseFloat(r.total_amount) || split.gross_booking);

  lines.push(journalLine('105000', guestTotal, 0, 'Guest receivable'));
  if (split.company_commission > 0) {
    lines.push(journalLine('401000', 0, split.company_commission, 'Management commission'));
  }
  if (split.owner_trust_credit > 0) {
    lines.push(journalLine('202000', 0, split.owner_trust_credit, 'Owner trust payable'));
  }
  if (split.vat_on_commission > 0) {
    lines.push(journalLine('205000', 0, split.vat_on_commission, 'Output VAT on commission'));
  }

  const credits = lines.reduce((s, l) => s + l.credit, 0);
  const debits = lines.reduce((s, l) => s + l.debit, 0);
  const diff = round2(debits - credits);
  if (diff > 0) {
    lines.push(journalLine('409000', 0, diff, 'Guest fees / balancing'));
  }

  return {
    id: ref,
    date: currentPeriodBasis() === CREATED ? r.created_at || r.check_in : r.check_in || r.created_at,
    type: 'booking',
    reference: ref,
    description: `${r.guest_name} — ${r.unit_name}`,
    lines,
  };
}


router.get('/financial-system/overview', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const rows = await loadReservations(req);

    let ownerTrust = 0;
    let commissionRevenue = 0;
    let guestDeposits = 0;
    let guestReceivable = 0;
    let gatewayClearing = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const r of rows) {
      const fin = calcReservationFinancials(r, r);
      const split = bookingSplit(fin, r);
      ownerTrust += split.owner_trust_credit;
      commissionRevenue += split.company_commission;

      const paid = parseFloat(r.amount_paid) || 0;
      const total = parseFloat(r.total_amount) || 0;
      guestReceivable += Math.max(0, total - paid);

      if (String(r.check_in) > today && paid > 0) {
        guestDeposits += paid;
      }
      if (isWebsiteOriginReservation(r) && paid > 0) {
        gatewayClearing += paid;
      }
    }

    const vat = outputVatOnCommission(commissionRevenue);

    const expParams = [from];
    let expWhere = `created_at::date >= $1::date AND COALESCE(paid_by, 'company') <> 'owner'`;
    if (to) {
      expParams.push(to);
      expWhere += ` AND created_at::date <= $${expParams.length}::date`;
    }
    const { rows: expenseRows } = await query(
      `SELECT id, description, amount, category, expense_date
       FROM expenses WHERE ${expWhere}`,
      expParams
    );

    let expensesPayable = 0;
    let totalWht = 0;
    for (const e of expenseRows) {
      const amt = parseFloat(e.amount) || 0;
      expensesPayable += amt;
      const wht = withholdingTax(amt, {
        ratePct: e.category === 'professional' ? 1 : 3,
      });
      totalWht += wht.wht_amount;
    }

    const pcParams = [from];
    let pcWhere = `entry_type = 'out' AND COALESCE(status, 'open') <> 'moved'
      AND COALESCE(paid_by, 'company') <> 'owner' AND created_at::date >= $1::date`;
    if (to) {
      pcParams.push(to);
      pcWhere += ` AND created_at::date <= $${pcParams.length}::date`;
    }
    const { rows: pettyRows } = await query(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM petty_cash WHERE ${pcWhere}`,
      pcParams
    );
    const pettyCash = Number(pettyRows[0]?.total) || 0;

    let pendingPayouts = 0;
    try {
      const { rows: payoutRows } = await query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total
         FROM owner_payout_requests WHERE status IN ('requested', 'approved')`
      );
      pendingPayouts = Number(payoutRows[0]?.total) || 0;
    } catch (_) {}

    const manualEntries = await loadManualEntries(from, to);
    const manualTotals = summarizeManualEntries(manualEntries);

    res.json({
      from_date: from,
      to_date: to,
      financial_epoch: FINANCIAL_EPOCH,
      kpis: {
        owner_trust: {
          label: 'Funds held for owners',
          amount: round2(ownerTrust),
          sub: `${rows.length} bookings in period`,
        },
        guest_deposits: {
          label: 'Guest deposits (unearned)',
          amount: round2(guestDeposits),
          sub: 'Paid ahead of future stays',
        },
        commission: {
          label: 'Cairo Homes commission earned',
          amount: round2(commissionRevenue),
          sub: 'Management fee revenue',
        },
        vat_payable: {
          label: 'VAT payable',
          amount: vat.vat_amount,
          sub: `${VAT_OUTPUT_PCT}% on commission`,
        },
        wht_payable: {
          label: 'Withholding tax',
          amount: round2(totalWht),
          sub: 'On expenses in period',
        },
      },
      supplemental: {
        guest_receivable: round2(guestReceivable),
        gateway_clearing: round2(gatewayClearing),
        expenses_payable: round2(expensesPayable),
        petty_cash_out: round2(pettyCash),
        pending_owner_payouts: round2(pendingPayouts),
        manual_revenue: manualTotals.revenue,
        manual_expense: manualTotals.expense,
        manual_misc_in: manualTotals.misc_in,
        manual_misc_out: manualTotals.misc_out,
        manual_misc_net: manualTotals.misc_net,
      },
      manual: manualTotals,
    });
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/booking-splits', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const rows = await loadReservations(req);
    const splits = rows.map((r) => {
      const fin = calcReservationFinancials(r, r);
      return {
        ...bookingSplit(fin, r),
        sales_person: r.sales_person_name,
        from_website: isWebsiteOriginReservation(r),
        payment_status: r.payment_status,
        total_amount: round2(parseFloat(r.total_amount) || 0),
        amount_paid: round2(parseFloat(r.amount_paid) || 0),
      };
    });
    res.json({ splits, count: splits.length });
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/owner-statements', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const unitId = req.query.unit_id || null;
    const { statements, ownerBalances } = await loadOwnerStatementData(from, to, unitId);

    let payouts = [];
    try {
      const { rows } = await query(
        `SELECT p.*, su.full_name AS owner_name
         FROM owner_payout_requests p
         LEFT JOIN staff_users su ON su.id = p.owner_id
         ORDER BY p.created_at DESC LIMIT 200`
      );
      payouts = rows;
    } catch (_) {}

    res.json({
      statements,
      owner_balances: ownerBalances,
      payouts,
      from_date: from,
      to_date: to,
    });
  } catch (e) {
    next(e);
  }
});


router.post('/financial-system/payouts/:id/settle', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const { rows } = await query(`SELECT * FROM owner_payout_requests WHERE id = $1`, [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Payout not found' });
    if (rows[0].status === 'paid') return res.json({ ok: true, payout: rows[0] });
    if (rows[0].status === 'rejected') {
      return res.status(400).json({ error: 'Cannot settle a rejected payout request' });
    }

    await query(
      `UPDATE owner_payout_requests SET
         status = 'paid',
         reviewed_by = $2,
         reviewed_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [id, req.user.id]
    );
    if (rows[0].settlement_id) {
      await query(
        `UPDATE owner_settlements SET status = 'paid', updated_at = now() WHERE id = $1`,
        [rows[0].settlement_id]
      );
    }
    const { rows: updated } = await query(`SELECT * FROM owner_payout_requests WHERE id = $1`, [id]);
    res.json({ ok: true, payout: updated[0] });
  } catch (e) {
    next(e);
  }
});

/**
 * Admin marks an owner's balance settled without an owner withdrawal request.
 * Creates a paid payout (and optional settlement) immediately.
 */
router.post('/financial-system/owners/:ownerId/settle', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const ownerId = parseInt(req.params.ownerId, 10);
    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      return res.status(400).json({ error: 'Invalid owner id' });
    }

    const { rows: owners } = await query(
      `SELECT id, full_name FROM staff_users WHERE id = $1 AND role = 'owner'`,
      [ownerId]
    );
    if (!owners[0]) return res.status(404).json({ error: 'Owner not found' });

    const { from, to } = dateRange(req);
    const settleDate = String(req.body.settle_date || to || new Date().toISOString().slice(0, 10)).slice(0, 10);
    await assertPeriodOpen(settleDate);

    const amountRaw = req.body.amount;
    let amount =
      amountRaw == null || amountRaw === ''
        ? null
        : round2(parseFloat(amountRaw));

    if (amount == null || Number.isNaN(amount)) {
      const balance = await computeOwnerPeriodBalance(ownerId, from, to);
      amount = balance.remaining;
    }

    if (!(amount > 0.009)) {
      return res.status(400).json({ error: 'Nothing to settle for this owner in the selected period' });
    }

    const periodEnd = to || settleDate;
    let settlementId = null;
    try {
      const { rows: existing } = await query(
        `SELECT id FROM owner_settlements
         WHERE owner_id = $1 AND period_start = $2::date AND period_end = $3::date
         ORDER BY id DESC LIMIT 1`,
        [ownerId, from, periodEnd]
      );
      if (existing[0]) {
        settlementId = existing[0].id;
        await query(
          `UPDATE owner_settlements SET
             status = 'paid',
             net_amount = $1,
             notes = COALESCE($2, notes),
             updated_at = now()
           WHERE id = $3`,
          [amount, req.body.notes || 'Admin settled without owner request', settlementId]
        );
      } else {
        const { rows: created } = await query(
          `INSERT INTO owner_settlements (
             owner_id, period_start, period_end, gross_amount, commission_amount, net_amount, status, notes
           ) VALUES ($1,$2,$3,$4,0,$4,'paid',$5)
           RETURNING id`,
          [
            ownerId,
            from,
            periodEnd,
            amount,
            req.body.notes || 'Admin settled without owner request',
          ]
        );
        settlementId = created[0]?.id || null;
      }
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }

    const { rows: payoutRows } = await query(
      `INSERT INTO owner_payout_requests (
         owner_id, settlement_id, amount, status, two_fa_verified, reviewed_by, reviewed_at
       ) VALUES ($1,$2,$3,'paid',1,$4,now())
       RETURNING *`,
      [ownerId, settlementId, amount, req.user.id]
    );

    res.status(201).json({
      ok: true,
      payout: payoutRows[0],
      owner: owners[0],
      amount,
      settle_date: settleDate,
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});


router.get('/financial-system/ledger', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const rows = await loadReservations(req);
    const journal = [];

    for (const r of rows.slice(0, 500)) {
      const fin = calcReservationFinancials(r, r);
      const split = bookingSplit(fin, r);
      journal.push(reservationJournalEntry(r, fin, split));
    }

    const expParams = [from];
    let expWhere = `created_at::date >= $1::date`;
    if (to) {
      expParams.push(to);
      expWhere += ` AND created_at::date <= $${expParams.length}::date`;
    }
    const { rows: expenses } = await query(
      `SELECT id, description, amount, category, expense_date
       FROM expenses WHERE ${expWhere} ORDER BY expense_date DESC LIMIT 200`,
      expParams
    );

    for (const e of expenses) {
      const amt = parseFloat(e.amount) || 0;
      const acct = EXPENSE_CATEGORY_TO_ACCOUNT[e.category] || '503000';
      const wht = withholdingTax(amt, { ratePct: e.category === 'professional' ? 1 : 3 });
      journal.push({
        id: `EXP-${e.id}`,
        date: e.expense_date,
        type: 'expense',
        reference: `EXP-${e.id}`,
        description: e.description || 'Expense',
        lines: [
          journalLine(acct, amt, 0, e.category || 'expense'),
          journalLine('201000', 0, round2(amt - wht.wht_amount), 'Payable'),
          ...(wht.wht_amount > 0
            ? [journalLine('206000', 0, wht.wht_amount, 'WHT withheld')]
            : []),
        ],
      });
    }

    const manualEntries = await loadManualEntries(from, to);
    for (const m of manualEntries) {
      journal.push(manualJournalEntry(m));
    }

    journal.sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const balances = {};
    for (const entry of journal) {
      for (const line of entry.lines) {
        if (!balances[line.account]) balances[line.account] = { debit: 0, credit: 0 };
        balances[line.account].debit += line.debit;
        balances[line.account].credit += line.credit;
      }
    }

    const accountBalances = CHART_OF_ACCOUNTS.map((acct) => ({
      name: acct.name,
      group: acct.group,
      type: acct.type,
      debit: round2(balances[acct.code]?.debit || 0),
      credit: round2(balances[acct.code]?.credit || 0),
      balance: round2(
        (balances[acct.code]?.debit || 0) - (balances[acct.code]?.credit || 0)
      ),
      code: acct.code,
    })).filter((a) => a.debit > 0 || a.credit > 0);

    res.json({
      chart_of_accounts: CHART_OF_ACCOUNTS.map(({ name, group, type }) => ({ name, group, type })),
      accounts_by_group: accountsByGroup(),
      journal,
      account_balances: accountBalances,
      from_date: from,
      to_date: to,
    });
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/tax', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to);
    const vat = vatReturn(built.journal);
    const rows = built.reservations || [];

    let commissionTotal = 0;
    for (const r of rows) {
      if (String(r.status || '').toLowerCase() === 'cancelled') continue;
      const fin = calcReservationFinancials(r, r);
      commissionTotal += fin.companyCommission || 0;
    }

    const expParams = [from];
    let expWhere = `created_at::date >= $1::date AND COALESCE(paid_by, 'company') <> 'owner'`;
    if (to) {
      expParams.push(to);
      expWhere += ` AND created_at::date <= $${expParams.length}::date`;
    }
    const { rows: expenseRows } = await query(
      `SELECT id, description, amount, category, expense_date FROM expenses WHERE ${expWhere}`,
      expParams
    );

    const vendorBills = expenseRows.map((e) => ({
      vendor: e.description || 'Expense',
      amount: parseFloat(e.amount) || 0,
      wht_rate_pct: e.category === 'professional' ? 1 : 3,
      date: e.expense_date,
    }));

    const monthLabel = to ? `${from} → ${to}` : `From ${from}`;
    const liability = monthlyTaxLiability({
      commissionTotal,
      vendorBills,
      monthLabel,
    });

    res.json({
      from_date: from,
      to_date: to,
      vat_output_pct: VAT_OUTPUT_PCT,
      liability,
      vat_return: vat,
      commission_taxable_base: round2(commissionTotal),
    });
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/export', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const portal = await buildFinancialPortal(from, to);
    const statements = buildStatements(
      portal.journal,
      portal.reservations,
      from,
      to,
      portal.data?.reservationTotals
    );
    statements.cash_flow = await buildCashFlowStatement(from, to);
    const asOf = to || new Date().toISOString().slice(0, 10);
    const wb = buildFinancialWorkbook({
      from,
      to,
      portal,
      statements,
      vat: vatReturn(portal.journal),
      aging: agingFromReservations(portal.reservations, asOf),
      trust: ownerTrustSubledger(portal.journal, portal.data || {}),
    });
    const buf = await workbookToBuffer(wb);
    const fromLabel = String(from || '').slice(0, 10);
    const toLabel = String(to || asOf).slice(0, 10);
    const filename = `cairo-homes-financial-report_${fromLabel}_to_${toLabel}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/units', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, COALESCE(unit_number, title) AS unit_name,
              COALESCE(project, compound) AS project
       FROM units ORDER BY project, unit_name`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/manual-entries', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const entries = await loadManualEntries(from, to);
    res.json({ entries, totals: summarizeManualEntries(entries), from_date: from, to_date: to });
  } catch (e) {
    next(e);
  }
});


router.post('/financial-system/manual-entries', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (!(amount > 0)) {
      return res.status(400).json({ error: 'amount must be greater than zero' });
    }

    const fromAccount = String(req.body.from_account || req.body.credit_account_code || '').trim();
    const toAccount = String(req.body.to_account || req.body.debit_account_code || '').trim();
    const hasAccounts = Boolean(fromAccount && toAccount);

    let entryType = String(req.body.entry_type || (hasAccounts ? 'journal' : '')).toLowerCase();
    if (!MANUAL_ENTRY_TYPES.has(entryType)) {
      return res.status(400).json({ error: 'Choose From and To accounts (or legacy revenue/expense)' });
    }

    let debitAccount = toAccount;
    let creditAccount = fromAccount;
    if (entryType === 'journal' || hasAccounts) {
      if (!getAccount(debitAccount) || !getAccount(creditAccount)) {
        return res.status(400).json({ error: 'from_account and to_account must be valid chart accounts' });
      }
      if (debitAccount === creditAccount) {
        return res.status(400).json({ error: 'From and To accounts must be different' });
      }
      entryType = 'journal';
    } else if (entryType === 'revenue') {
      debitAccount = '101000';
      creditAccount = '409000';
    } else if (entryType === 'expense') {
      debitAccount = '503000';
      creditAccount = '201000';
    }

    const notes = req.body.notes ? String(req.body.notes).trim() : null;
    const description =
      String(req.body.description || '').trim() ||
      notes ||
      `Manual journal ${creditAccount} → ${debitAccount}`;

    const entryDate = req.body.entry_date || new Date().toISOString().slice(0, 10);
    if (String(entryDate) < FINANCIAL_EPOCH) {
      return res.status(400).json({ error: `entry_date cannot be before ${FINANCIAL_EPOCH}` });
    }
    await assertPeriodOpen(entryDate);

    const unitId = req.body.unit_id || null;

    const { rows } = await query(
      `INSERT INTO financial_manual_entries
         (entry_type, misc_flow, description, amount, entry_date, notes, unit_id, created_by,
          debit_account_code, credit_account_code)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [entryType, description, amount, entryDate, notes, unitId, req.user.id, debitAccount, creditAccount]
    );

    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});


router.get('/financial-system/portal', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to);
    res.json({
      from_date: from,
      to_date: to,
      financial_epoch: FINANCIAL_EPOCH,
      kpis: built.kpis,
      treasury: built.treasury,
      groups: built.groups,
      outstanding: built.outstanding,
      recurring: built.recurring,
      payouts: built.payouts || [],
      closes: built.closes || [],
      settings: built.settings || {},
      receipts: built.receipts || {},
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/accounts/:code', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const code = String(req.params.code || '').trim();
    const acct = getAccount(code);
    if (!acct) return res.status(404).json({ error: 'Unknown account' });
    const built = await buildFinancialPortal(from, to);
    const summary = (built.accounts || []).find((a) => a.code === code) || {
      ...acct,
      debit: 0,
      credit: 0,
      balance: 0,
      txn_count: 0,
    };
    res.json({
      from_date: from,
      to_date: to,
      account: summary,
      transactions: mirrorTransactions(built.journal, code, {
        reservations: built.reservations,
        from,
        to,
      }),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/transactions/:id', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const id = decodeURIComponent(req.params.id || '');
    const built = await buildFinancialPortal(from, to);
    const entry = built.journal.find((e) => e.id === id);
    if (!entry) return res.status(404).json({ error: 'Transaction not found in this period' });
    const fromLine = entry.lines.find((l) => l.credit > 0);
    const toLine = entry.lines.find((l) => l.debit > 0);
    res.json({
      ...entry,
      flow: {
        from_account: fromLine?.account || entry.meta?.from_account || null,
        from_name: fromLine?.account_name || accountLabel(entry.meta?.from_account),
        to_account: toLine?.account || entry.meta?.to_account || null,
        to_name: toLine?.account_name || accountLabel(entry.meta?.to_account),
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/recurring', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT kind, label, account_code, amount_egp, day_of_month, is_active
       FROM financial_recurring_charges ORDER BY kind`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.put('/financial-system/recurring/:kind', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const kind = String(req.params.kind || '').toLowerCase();
    if (!['rent', 'buffet'].includes(kind)) {
      return res.status(400).json({ error: 'Unknown recurring charge' });
    }
    await assertPeriodOpen(new Date().toISOString().slice(0, 10));
    const amount = Math.max(0, parseFloat(req.body.amount_egp) || 0);
    const day = Math.min(28, Math.max(1, parseInt(req.body.day_of_month, 10) || 1));
    const active = req.body.is_active === 0 || req.body.is_active === false ? 0 : 1;
    const { rows } = await query(
      `UPDATE financial_recurring_charges
       SET amount_egp = $2, day_of_month = $3, is_active = $4, updated_at = now(), updated_by = $5
       WHERE kind = $1
       RETURNING *`,
      [kind, amount, day, active, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Charge not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.delete('/financial-system/manual-entries/:id', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { rows: existing } = await query(
      `SELECT id, entry_date FROM financial_manual_entries WHERE id = $1`,
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Entry not found' });
    await assertPeriodOpen(existing[0].entry_date);
    await query(`DELETE FROM financial_manual_entries WHERE id = $1`, [req.params.id]);
    res.json({ ok: true, id: existing[0].id });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/reports', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildYtdStatements(to, from);
    res.json({
      from_date: built.from_date,
      to_date: built.to_date,
      trial_balance: built.trial_balance,
      profit_and_loss: built.profit_and_loss,
      balance_sheet: built.balance_sheet,
      cash_flow: built.cash_flow,
      vat_return: built.vat_return,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/aging', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to);
    const asOf = to || new Date().toISOString().slice(0, 10);
    res.json({
      from_date: from,
      to_date: to,
      ar_balance: built.kpis?.guest_ar || 0,
      ...agingFromReservations(built.reservations, asOf),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/owner-trust', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { to } = dateRange(req);
    const built = await buildYtdStatements(to);
    res.json({
      from_date: built.from_date,
      to_date: built.to_date,
      control_202000: built.owner_trust.control_202000,
      tied: built.owner_trust.tied,
      owners: built.owner_trust.rows,
      holdbacks: built.data?.holdbacks || [],
    });
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/holdbacks', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const ownerId = parseInt(req.body.owner_id, 10);
    const amount = parseFloat(req.body.amount);
    if (!ownerId || !(amount > 0)) {
      return res.status(400).json({ error: 'owner_id and a positive amount are required' });
    }
    await assertPeriodOpen(new Date().toISOString().slice(0, 10));
    const { rows } = await query(
      `INSERT INTO financial_owner_holdbacks (owner_id, unit_id, amount, reason, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [ownerId, req.body.unit_id || null, amount, req.body.reason || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/holdbacks/:id/release', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    await assertPeriodOpen(new Date().toISOString().slice(0, 10));
    const { rows } = await query(
      `UPDATE financial_owner_holdbacks SET is_released = 1 WHERE id = $1 AND is_released = 0 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Holdback not found or already released' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/gateway', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to);
    const settlements = (built.journal || []).filter((e) => e.type === 'gateway_settle');
    const clearingIn = (built.journal || [])
      .filter((e) => e.type === 'collection' && e.meta?.treasury_account === '106000')
      .reduce((s, e) => s + (e.debit || 0), 0);
    const mdr = settlements.reduce((s, e) => s + (Number(e.meta?.mdr_amount) || 0), 0);
    const net = settlements.reduce((s, e) => s + (Number(e.meta?.net) || 0), 0);
    res.json({
      from_date: from,
      to_date: to,
      mdr_pct: built.settings?.gateway_mdr_pct || 1.5,
      clearing_in: round2(clearingIn),
      settled_net: round2(net),
      mdr_expense: round2(mdr),
      uncleared: built.kpis?.gateway_clearing || 0,
      settlements,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/settings', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT key, value_num, value_text FROM financial_settings`);
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value_num != null ? r.value_num : r.value_text])));
  } catch (e) {
    if (e.code === '42P01') return res.json({ gateway_mdr_pct: 1.5 });
    next(e);
  }
});

router.put('/financial-system/settings/:key', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const key = String(req.params.key || '').trim();
    if (key !== 'gateway_mdr_pct') return res.status(400).json({ error: 'Unknown setting' });
    const value = Math.max(0, Math.min(15, parseFloat(req.body.value_num) || 0));
    const { rows } = await query(
      `INSERT INTO financial_settings (key, value_num, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value_num = $2, updated_at = now()
       RETURNING *`,
      [key, value]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/periods', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.*, su.full_name AS closed_by_name
       FROM financial_period_closes c
       LEFT JOIN staff_users su ON su.id = c.closed_by
       ORDER BY c.year_month DESC`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/financial-system/periods/:yearMonth/close', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const yearMonth = String(req.params.yearMonth || '');
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      return res.status(400).json({ error: 'yearMonth must be YYYY-MM' });
    }
    const from = `${yearMonth}-01`;
    const to = lastDayOfMonth(yearMonth);
    const data = await loadPortalData(from, to);
    const journal = buildJournal(data, from, to, { includeCloses: false });
    const close = closeMonthEntry(yearMonth, journal);
    const pnl = Number(close.meta?.pnl) || 0;
    const { rows } = await query(
      `INSERT INTO financial_period_closes (year_month, pnl_amount, closed_by, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (year_month) DO NOTHING
       RETURNING *`,
      [yearMonth, pnl, req.user.id, req.body.notes || null]
    );
    if (!rows[0]) return res.status(409).json({ error: `${yearMonth} is already closed` });
    res.status(201).json({ close: rows[0], pnl, entry: close });
  } catch (e) {
    next(e);
  }
});

router.delete('/financial-system/periods/:yearMonth/close', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `DELETE FROM financial_period_closes WHERE year_month = $1 RETURNING year_month`,
      [req.params.yearMonth]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Period is not closed' });
    res.json({ ok: true, year_month: rows[0].year_month });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/bank-rec', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const code = String(req.query.account || '101000');
    if (!['101000', '102000', '103000', '104000'].includes(code)) {
      return res.status(400).json({ error: 'Treasury account required' });
    }
    const built = await buildFinancialPortal(from, to);
    const reconciled = new Set((built.reconciled || []).filter((r) => r.account_code === code).map((r) => r.entry_id));
    const lines = mirrorTransactions(built.journal, code).map((row) => ({
      ...row,
      reconciled: reconciled.has(row.id),
    }));
    const book = (built.accounts || []).find((a) => a.code === code);
    let snapshots = [];
    try {
      const { rows } = await query(
        `SELECT * FROM financial_bank_snapshots WHERE account_code = $1 ORDER BY statement_date DESC, id DESC LIMIT 20`,
        [code]
      );
      snapshots = rows;
    } catch (_) {}
    res.json({
      account: book,
      lines,
      snapshots,
      unreconciled: round2(lines.filter((l) => !l.reconciled).reduce((s, l) => s + (l.side === 'debit' ? l.amount : -l.amount), 0)),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/bank-rec/toggle', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const entryId = String(req.body.entry_id || '').trim();
    const accountCode = String(req.body.account_code || '101000');
    if (!entryId) return res.status(400).json({ error: 'entry_id is required' });
    const { rows: existing } = await query(
      `SELECT entry_id FROM financial_reconciled_entries WHERE entry_id = $1`,
      [entryId]
    );
    if (existing[0]) {
      await query(`DELETE FROM financial_reconciled_entries WHERE entry_id = $1`, [entryId]);
      return res.json({ ok: true, reconciled: false });
    }
    await query(
      `INSERT INTO financial_reconciled_entries (entry_id, account_code, reconciled_by)
       VALUES ($1, $2, $3)`,
      [entryId, accountCode, req.user.id]
    );
    res.json({ ok: true, reconciled: true });
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/bank-rec/snapshot', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const accountCode = String(req.body.account_code || '101000');
    const statementDate = req.body.statement_date || new Date().toISOString().slice(0, 10);
    const balance = parseFloat(req.body.statement_balance);
    if (!Number.isFinite(balance)) return res.status(400).json({ error: 'statement_balance is required' });
    const { rows } = await query(
      `INSERT INTO financial_bank_snapshots (account_code, statement_date, statement_balance, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [accountCode, statementDate, balance, req.body.notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

function mapInsuranceRow(r) {
  const held = round2(parseFloat(r.insurance) || 0);
  const refunded = round2(parseFloat(r.insurance_refunded_amount) || 0);
  const damage = round2(parseFloat(r.insurance_damage_amount) || 0);
  const status = String(r.insurance_refund_status || '').toLowerCase();
  const settled = ['refunded', 'partial', 'forfeited'].includes(status);
  return {
    reservation_id: r.id,
    booking_id: r.booking_id,
    guest_name: r.guest_name,
    guest_phone: r.guest_phone,
    unit_id: r.unit_id,
    unit_name: r.unit_name,
    project: r.project,
    status: r.status,
    check_in: r.check_in,
    check_out: r.check_out,
    insurance: held,
    insurance_refund_status: settled ? status : 'pending',
    insurance_refunded_amount: refunded,
    insurance_damage_amount: damage,
    insurance_refunded_at: r.insurance_refunded_at,
    insurance_refund_method: r.insurance_refund_method,
    insurance_refund_notes: r.insurance_refund_notes,
    refunded_by_name: r.refunded_by_name || null,
    due_amount: settled ? 0 : held,
  };
}

/** Checkout on/after this date is tracked for insurance refunds; earlier stays are treated as settled. */
const INSURANCE_REFUND_TRACKING_START = '2026-08-24';

/** Insurance collected at check-in (204000); due for refund on checkout. */
router.get('/financial-system/insurance-refunds', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const filter = String(req.query.filter || 'due').toLowerCase();
    const { rows } = await query(
      `SELECT r.id, r.booking_id, r.guest_name, r.guest_phone, r.unit_id, r.status,
              to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
              to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
              COALESCE(r.insurance, 0)::float AS insurance,
              r.insurance_refund_status,
              COALESCE(r.insurance_refunded_amount, 0)::float AS insurance_refunded_amount,
              COALESCE(r.insurance_damage_amount, 0)::float AS insurance_damage_amount,
              r.insurance_refunded_at,
              r.insurance_refund_method,
              r.insurance_refund_notes,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
              COALESCE(u.project, u.compound) AS project,
              su.full_name AS refunded_by_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users su ON su.id = r.insurance_refunded_by
       WHERE COALESCE(r.insurance, 0) > 0.009
         AND LOWER(COALESCE(r.status::text, '')) <> 'cancelled'
       ORDER BY r.check_out ASC, r.id ASC`
    );

    const mapped = rows.map(mapInsuranceRow);
    const isPending = (r) => r.insurance_refund_status === 'pending';
    const inTrackingWindow = (r) => r.check_out && r.check_out >= INSURANCE_REFUND_TRACKING_START;

    const due = mapped.filter(
      (r) => isPending(r) && inTrackingWindow(r) && r.check_out <= today
    );
    const upcoming = mapped.filter(
      (r) => isPending(r) && inTrackingWindow(r) && r.check_out > today
    );
    const settled = mapped
      .filter((r) => !isPending(r) || (r.check_out && r.check_out < INSURANCE_REFUND_TRACKING_START))
      .map((r) =>
        isPending(r)
          ? {
              ...r,
              insurance_refund_status: 'refunded',
              insurance_refunded_amount: r.insurance,
              due_amount: 0,
            }
          : r
      )
      .sort((a, b) => String(b.insurance_refunded_at || b.check_out || '').localeCompare(String(a.insurance_refunded_at || a.check_out || '')));

    let list = due;
    if (filter === 'upcoming') list = upcoming;
    else if (filter === 'settled') list = settled.slice(0, 200);
    else if (filter === 'all') list = [...due, ...upcoming, ...settled.slice(0, 100)];

    const escrowBalance = round2(
      mapped
        .filter((r) => isPending(r) && inTrackingWindow(r) && r.check_in && r.check_in <= today)
        .reduce((s, r) => s + r.insurance, 0)
    );

    res.json({
      filter,
      as_of: today,
      tracking_start: INSURANCE_REFUND_TRACKING_START,
      account: {
        code: '204000',
        name: getAccount('204000')?.name || 'Guest Insurance Payable',
      },
      damage_account: {
        code: '410000',
        name: getAccount('410000')?.name || 'Insurance Damage Retention Revenue',
      },
      summary: {
        due_count: due.length,
        due_amount: round2(due.reduce((s, r) => s + r.insurance, 0)),
        upcoming_count: upcoming.length,
        upcoming_amount: round2(upcoming.reduce((s, r) => s + r.insurance, 0)),
        settled_count: settled.length,
        escrow_open: escrowBalance,
      },
      rows: list,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Finance desk: audit trail for ops check-ins (money collected, payments, bill edits, handover).
 * GET /financial-system/checkin-audit?from=&to=
 * GET /financial-system/checkin-audit/:id  — one reservation with payments + audit events
 */
function parseCheckinAuditRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDefaultDate = new Date();
  fromDefaultDate.setUTCDate(fromDefaultDate.getUTCDate() - 30);
  const fromDefault = fromDefaultDate.toISOString().slice(0, 10);
  const from = clampFromDate(query.from || query.from_date || fromDefault);
  const to = String(query.to || query.to_date || today).slice(0, 10);
  return { from, to };
}

function mapCheckinAuditRow(r) {
  const total = round2(parseFloat(r.total_amount) || 0);
  const paid = round2(parseFloat(r.amount_paid) || 0);
  const collected = round2(parseFloat(r.ops_money_collected_amount) || 0);
  return {
    reservation_id: r.id,
    guest_name: r.guest_name,
    guest_phone: r.guest_phone,
    unit_name: r.unit_name,
    project: r.project,
    check_in: r.check_in,
    check_out: r.check_out,
    status: r.status,
    payment_status: r.payment_status,
    total_amount: total,
    amount_paid: paid,
    balance_due: round2(Math.max(0, total - paid)),
    accommodation: round2(parseFloat(r.accommodation) || 0),
    beach_access_fees: round2(parseFloat(r.beach_access_fees) || 0),
    insurance: round2(parseFloat(r.insurance) || 0),
    ops_money_collected: Number(r.ops_money_collected) === 1,
    ops_money_collected_amount: collected,
    ops_money_collected_at: r.ops_money_collected_at || null,
    ops_money_collected_by_name: r.ops_money_collected_by_name || null,
    ops_handed_over: Number(r.ops_handed_over) === 1,
    ops_handed_over_at: r.ops_handed_over_at || null,
    ops_handed_over_by_name: r.ops_handed_over_by_name || null,
    ops_assignee_name: r.ops_assignee_name || null,
    payment_count: Number(r.payment_count) || 0,
    payments_total: round2(parseFloat(r.payments_total) || 0),
  };
}

router.get('/financial-system/checkin-audit', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = parseCheckinAuditRange(req.query);
    const { rows } = await query(
      `SELECT r.id,
              r.guest_name,
              r.guest_phone,
              to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
              to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
              r.status,
              r.payment_status,
              COALESCE(r.total_amount, 0)::float AS total_amount,
              COALESCE(r.amount_paid, 0)::float AS amount_paid,
              COALESCE(
                CASE
                  WHEN COALESCE(r.price_per_night, 0) > 0 AND COALESCE(r.nights, 0) > 0
                  THEN r.price_per_night * r.nights
                  ELSE 0
                END,
                0
              )::float AS accommodation,
              COALESCE(r.beach_access_fees, 0)::float AS beach_access_fees,
              COALESCE(r.insurance, 0)::float AS insurance,
              COALESCE(r.ops_money_collected, 0) AS ops_money_collected,
              COALESCE(r.ops_money_collected_amount, 0)::float AS ops_money_collected_amount,
              r.ops_money_collected_at,
              COALESCE(r.ops_handed_over, 0) AS ops_handed_over,
              r.ops_handed_over_at,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
              COALESCE(u.project, u.compound) AS project,
              money_by.full_name AS ops_money_collected_by_name,
              hand_by.full_name AS ops_handed_over_by_name,
              ops_agent.full_name AS ops_assignee_name,
              COALESCE(pagg.payment_count, 0)::int AS payment_count,
              COALESCE(pagg.payments_total, 0)::float AS payments_total
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users money_by ON money_by.id = r.ops_money_collected_by
       LEFT JOIN staff_users hand_by ON hand_by.id = r.ops_handed_over_by
       LEFT JOIN staff_users ops_agent ON ops_agent.id = r.ops_assigned_to
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS payment_count,
                COALESCE(SUM(p.amount), 0)::float AS payments_total
         FROM payments p
         WHERE p.reservation_id = r.id
           AND LOWER(COALESCE(p.status, '')) NOT IN ('cancelled', 'failed', 'refunded')
       ) pagg ON TRUE
       WHERE r.check_in::date >= $1::date
         AND r.check_in::date <= $2::date
         AND LOWER(COALESCE(r.status::text, '')) <> 'cancelled'
         AND (
           COALESCE(r.ops_money_collected, 0) = 1
           OR COALESCE(r.ops_handed_over, 0) = 1
           OR EXISTS (
             SELECT 1 FROM payments px
             WHERE px.reservation_id = r.id
               AND (
                 px.notes ILIKE '%[ops check-in]%'
                 OR px.notes ILIKE '%ops_handover%'
                 OR px.notes ILIKE '%ops check-in%'
               )
           )
         )
       ORDER BY r.check_in DESC, r.id DESC
       LIMIT 500`,
      [from, to]
    );

    const mapped = rows.map(mapCheckinAuditRow);
    const collectedTotal = round2(
      mapped.reduce((s, r) => s + (r.ops_money_collected_amount || 0), 0)
    );
    const paidTotal = round2(mapped.reduce((s, r) => s + (r.amount_paid || 0), 0));

    res.json({
      from,
      to,
      summary: {
        checkin_count: mapped.length,
        money_collected_total: collectedTotal,
        amount_paid_total: paidTotal,
        handed_over_count: mapped.filter((r) => r.ops_handed_over).length,
      },
      rows: mapped,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/checkin-audit/:id', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid reservation id' });

    const { rows } = await query(
      `SELECT r.id,
              r.guest_name,
              r.guest_phone,
              to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
              to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
              r.status,
              r.payment_status,
              COALESCE(r.total_amount, 0)::float AS total_amount,
              COALESCE(r.amount_paid, 0)::float AS amount_paid,
              COALESCE(
                CASE
                  WHEN COALESCE(r.price_per_night, 0) > 0 AND COALESCE(r.nights, 0) > 0
                  THEN r.price_per_night * r.nights
                  ELSE 0
                END,
                0
              )::float AS accommodation,
              COALESCE(r.beach_access_fees, 0)::float AS beach_access_fees,
              COALESCE(r.insurance, 0)::float AS insurance,
              COALESCE(r.ops_money_collected, 0) AS ops_money_collected,
              COALESCE(r.ops_money_collected_amount, 0)::float AS ops_money_collected_amount,
              r.ops_money_collected_at,
              COALESCE(r.ops_handed_over, 0) AS ops_handed_over,
              r.ops_handed_over_at,
              r.ops_handover_comment,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
              COALESCE(u.project, u.compound) AS project,
              money_by.full_name AS ops_money_collected_by_name,
              hand_by.full_name AS ops_handed_over_by_name,
              ops_agent.full_name AS ops_assignee_name,
              0 AS payment_count,
              0 AS payments_total
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users money_by ON money_by.id = r.ops_money_collected_by
       LEFT JOIN staff_users hand_by ON hand_by.id = r.ops_handed_over_by
       LEFT JOIN staff_users ops_agent ON ops_agent.id = r.ops_assigned_to
       WHERE r.id = $1`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Reservation not found' });

    const { rows: payments } = await query(
      `SELECT p.id, p.amount, p.payment_method, p.payment_date, p.paid_at, p.status,
              p.notes, p.is_approved, p.created_at, p.created_by,
              su.full_name AS created_by_name
       FROM payments p
       LEFT JOIN staff_users su ON su.id = p.created_by
       WHERE p.reservation_id = $1
       ORDER BY COALESCE(p.paid_at, p.payment_date::timestamptz, p.created_at) ASC, p.id ASC`,
      [id]
    );

    const { rows: events } = await query(
      `SELECT a.id, a.action, a.details, a.created_at, a.user_id,
              su.full_name AS actor_name
       FROM audit_log a
       LEFT JOIN staff_users su ON su.id = a.user_id
       WHERE a.entity_type = 'reservation'
         AND a.entity_id = $1::text
         AND a.action IN (
           'OPS_COLLECT_CHECKIN',
           'OPS_HANDOVER_CHECKIN',
           'OPS_EDIT_CHECKIN_BILL',
           'OPS_ASSIGN_CHECKIN',
           'CREATE_PAYMENT',
           'APPROVE_PAYMENT',
           'RECORD_PAYMENT'
         )
       ORDER BY a.created_at ASC, a.id ASC`,
      [String(id)]
    );

    const base = mapCheckinAuditRow({
      ...rows[0],
      payment_count: payments.length,
      payments_total: payments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0),
    });

    res.json({
      ...base,
      ops_handover_comment: rows[0].ops_handover_comment || null,
      payments: payments.map((p) => ({
        id: p.id,
        amount: round2(parseFloat(p.amount) || 0),
        payment_method: p.payment_method,
        payment_date: p.payment_date,
        paid_at: p.paid_at,
        status: p.status,
        notes: p.notes,
        is_approved: Number(p.is_approved) === 1,
        created_at: p.created_at,
        created_by_name: p.created_by_name || null,
      })),
      events: events.map((e) => ({
        id: e.id,
        action: e.action,
        details: e.details || {},
        created_at: e.created_at,
        actor_name: e.actor_name || null,
      })),
    });
  } catch (e) {
    next(e);
  }
});

const {
  buildPaymentCalendar,
  ensureFinanceCalendarTable,
  isoDate: calendarIsoDate,
} = require('../../lib/finance/paymentCalendar');

router.get('/financial-system/payment-calendar', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const payload = await buildPaymentCalendar(req.query.from || req.query.from_date, req.query.to || req.query.to_date);
    res.json(payload);
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/payment-calendar', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    await ensureFinanceCalendarTable();
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const dueDate = calendarIsoDate(b.due_date);
    const amount = round2(parseFloat(b.amount) || 0);
    const direction = String(b.direction || 'out').toLowerCase() === 'in' ? 'in' : 'out';
    const status = ['pending', 'paid', 'cancelled'].includes(String(b.status || '').toLowerCase())
      ? String(b.status).toLowerCase()
      : 'pending';
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!dueDate) return res.status(400).json({ error: 'Due date is required' });

    const { rows } = await query(
      `INSERT INTO finance_calendar_payments
         (title, amount, currency, due_date, direction, category, status, paid_at, notes, account_code, related_ref, created_by, updated_by)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       RETURNING *`,
      [
        title,
        amount,
        String(b.currency || 'EGP').slice(0, 8),
        dueDate,
        direction,
        String(b.category || 'other').slice(0, 64) || 'other',
        status,
        status === 'paid' ? new Date().toISOString() : null,
        b.notes != null ? String(b.notes) : null,
        b.account_code != null ? String(b.account_code).slice(0, 16) : null,
        b.related_ref != null ? String(b.related_ref) : null,
        req.user.id,
      ]
    );
    res.status(201).json({ ok: true, item: rows[0] });
  } catch (e) {
    next(e);
  }
});

router.patch('/financial-system/payment-calendar/:id', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    await ensureFinanceCalendarTable();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { rows: existing } = await query(`SELECT * FROM finance_calendar_payments WHERE id = $1`, [id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });

    const b = req.body || {};
    const title = b.title != null ? String(b.title).trim() : existing[0].title;
    const dueDate = b.due_date != null ? calendarIsoDate(b.due_date) : String(existing[0].due_date).slice(0, 10);
    const amount = b.amount != null ? round2(parseFloat(b.amount) || 0) : round2(parseFloat(existing[0].amount) || 0);
    const direction =
      b.direction != null
        ? String(b.direction).toLowerCase() === 'in'
          ? 'in'
          : 'out'
        : existing[0].direction;
    let status = existing[0].status;
    if (b.status != null && ['pending', 'paid', 'cancelled'].includes(String(b.status).toLowerCase())) {
      status = String(b.status).toLowerCase();
    }
    if (!title) return res.status(400).json({ error: 'Title is required' });
    if (!dueDate) return res.status(400).json({ error: 'Due date is required' });

    let paidAt = existing[0].paid_at;
    if (status === 'paid' && !paidAt) paidAt = new Date().toISOString();
    if (status !== 'paid') paidAt = null;

    const { rows } = await query(
      `UPDATE finance_calendar_payments SET
         title = $2,
         amount = $3,
         due_date = $4::date,
         direction = $5,
         category = $6,
         status = $7,
         paid_at = $8,
         notes = $9,
         account_code = $10,
         related_ref = $11,
         updated_by = $12,
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        title,
        amount,
        dueDate,
        direction,
        b.category != null ? String(b.category).slice(0, 64) : existing[0].category,
        status,
        paidAt,
        b.notes !== undefined ? (b.notes != null ? String(b.notes) : null) : existing[0].notes,
        b.account_code !== undefined
          ? b.account_code != null
            ? String(b.account_code).slice(0, 16)
            : null
          : existing[0].account_code,
        b.related_ref !== undefined
          ? b.related_ref != null
            ? String(b.related_ref)
            : null
          : existing[0].related_ref,
        req.user.id,
      ]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (e) {
    next(e);
  }
});

router.delete('/financial-system/payment-calendar/:id', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    await ensureFinanceCalendarTable();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const { rowCount } = await query(`DELETE FROM finance_calendar_payments WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, id });
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/insurance-refunds/:id/settle', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid reservation id' });

    const { rows } = await query(
      `SELECT id, insurance, insurance_refund_status, check_out, status
       FROM reservations WHERE id = $1`,
      [id]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ error: 'Reservation not found' });

    const held = round2(parseFloat(r.insurance) || 0);
    if (!(held > 0.009)) {
      return res.status(400).json({ error: 'This reservation has no insurance to refund' });
    }

    const existing = String(r.insurance_refund_status || '').toLowerCase();
    if (['refunded', 'partial', 'forfeited'].includes(existing)) {
      return res.status(400).json({ error: 'Insurance already settled for this stay' });
    }

    let refunded =
      req.body.refunded_amount != null && req.body.refunded_amount !== ''
        ? round2(parseFloat(req.body.refunded_amount))
        : held;
    let damage =
      req.body.damage_amount != null && req.body.damage_amount !== ''
        ? round2(parseFloat(req.body.damage_amount))
        : 0;

    if (!Number.isFinite(refunded) || refunded < 0 || !Number.isFinite(damage) || damage < 0) {
      return res.status(400).json({ error: 'refunded_amount and damage_amount must be non-negative numbers' });
    }
    if (Math.abs(round2(refunded + damage) - held) > 0.05) {
      return res.status(400).json({
        error: `Refunded + damage must equal insurance held (EGP ${held.toFixed(2)})`,
      });
    }

    const method = String(req.body.payment_method || 'cash').toLowerCase();
    const allowedMethods = new Set(['cash', 'instapay', 'bank_transfer', 'credit_card', 'online']);
    if (!allowedMethods.has(method)) {
      return res.status(400).json({ error: 'Invalid payment_method' });
    }

    const refundDate = req.body.refunded_at
      ? String(req.body.refunded_at).slice(0, 10)
      : r.check_out
        ? String(r.check_out).slice(0, 10)
        : new Date().toISOString().slice(0, 10);

    await assertPeriodOpen(refundDate);

    let status = 'refunded';
    if (damage > 0.009 && refunded > 0.009) status = 'partial';
    else if (damage > 0.009 && !(refunded > 0.009)) status = 'forfeited';

    const { rows: updated } = await query(
      `UPDATE reservations SET
         insurance_refund_status = $2,
         insurance_refunded_amount = $3,
         insurance_damage_amount = $4,
         insurance_refunded_at = $5::date,
         insurance_refund_method = $6,
         insurance_refund_notes = $7,
         insurance_refunded_by = $8,
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, insurance, insurance_refund_status, insurance_refunded_amount,
                 insurance_damage_amount, insurance_refunded_at, insurance_refund_method,
                 insurance_refund_notes`,
      [
        id,
        status,
        refunded,
        damage,
        refundDate,
        method,
        req.body.notes ? String(req.body.notes).slice(0, 2000) : null,
        req.user.id,
      ]
    );

    res.json({
      ok: true,
      settlement: updated[0],
      journal_hint: {
        debit: '204000',
        credit_refund: refunded > 0 ? method : null,
        credit_damage: damage > 0 ? '410000' : null,
      },
    });
  } catch (e) {
    next(e);
  }
});

// ─── Fixed Assets & Depreciation ───────────────────────────────────

router.get('/financial-system/fixed-assets', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT fa.*,
              (SELECT d.accumulated FROM fixed_asset_depreciation d WHERE d.asset_id = fa.id ORDER BY d.period_month DESC LIMIT 1) AS accumulated_depreciation,
              (SELECT d.book_value FROM fixed_asset_depreciation d WHERE d.asset_id = fa.id ORDER BY d.period_month DESC LIMIT 1) AS current_book_value
       FROM fixed_assets fa
       ORDER BY fa.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/financial-system/fixed-assets', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { name, description, category, account_code, depreciation_account, expense_account, purchase_date, purchase_cost, salvage_value, useful_life_months, depreciation_method, notes, unit_id } = req.body;
    if (!name || !purchase_date || !(parseFloat(purchase_cost) > 0)) {
      return res.status(400).json({ error: 'name, purchase_date, and a positive purchase_cost are required' });
    }
    const { rows: countRows } = await query(`SELECT COUNT(*)::int AS c FROM fixed_assets`);
    const seq = (countRows[0]?.c || 0) + 1;
    const asset_code = `FA-${String(seq).padStart(3, '0')}`;
    const { rows } = await query(
      `INSERT INTO fixed_assets (asset_code, name, description, category, account_code, depreciation_account, expense_account, purchase_date, purchase_cost, salvage_value, useful_life_months, depreciation_method, notes, unit_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        asset_code,
        name,
        description || null,
        category || 'equipment',
        account_code || '150000',
        depreciation_account || '159000',
        expense_account || '606000',
        purchase_date,
        round2(parseFloat(purchase_cost)),
        round2(parseFloat(salvage_value) || 0),
        parseInt(useful_life_months, 10) || 36,
        depreciation_method || 'straight_line',
        notes || null,
        unit_id || null,
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.put('/financial-system/fixed-assets/:id', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { name, description, category, account_code, depreciation_account, expense_account, purchase_date, purchase_cost, salvage_value, useful_life_months, depreciation_method, notes, unit_id } = req.body;
    const { rows } = await query(
      `UPDATE fixed_assets SET
         name = COALESCE($2, name),
         description = $3,
         category = COALESCE($4, category),
         account_code = COALESCE($5, account_code),
         depreciation_account = COALESCE($6, depreciation_account),
         expense_account = COALESCE($7, expense_account),
         purchase_date = COALESCE($8, purchase_date),
         purchase_cost = COALESCE($9, purchase_cost),
         salvage_value = COALESCE($10, salvage_value),
         useful_life_months = COALESCE($11, useful_life_months),
         depreciation_method = COALESCE($12, depreciation_method),
         notes = $13,
         unit_id = $14,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        name || null,
        description ?? null,
        category || null,
        account_code || null,
        depreciation_account || null,
        expense_account || null,
        purchase_date || null,
        purchase_cost ? round2(parseFloat(purchase_cost)) : null,
        salvage_value != null ? round2(parseFloat(salvage_value)) : null,
        useful_life_months ? parseInt(useful_life_months, 10) : null,
        depreciation_method || null,
        notes ?? null,
        unit_id || null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Asset not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/fixed-assets/:id/dispose', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { disposed_date, disposed_amount } = req.body;
    const date = disposed_date || new Date().toISOString().slice(0, 10);
    await assertPeriodOpen(date);
    const { rows } = await query(
      `UPDATE fixed_assets SET
         status = 'disposed',
         disposed_date = $2,
         disposed_amount = $3,
         updated_at = NOW()
       WHERE id = $1 AND status = 'active'
       RETURNING *`,
      [req.params.id, date, disposed_amount != null ? round2(parseFloat(disposed_amount)) : null]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Asset not found or already disposed' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/fixed-assets/:id/schedule', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { rows: assetRows } = await query(`SELECT * FROM fixed_assets WHERE id = $1`, [req.params.id]);
    if (!assetRows[0]) return res.status(404).json({ error: 'Asset not found' });
    const { rows } = await query(
      `SELECT * FROM fixed_asset_depreciation WHERE asset_id = $1 ORDER BY period_month`,
      [req.params.id]
    );
    res.json({ asset: assetRows[0], schedule: rows });
  } catch (e) {
    if (e.code === '42P01') return res.json({ asset: null, schedule: [] });
    next(e);
  }
});

router.post('/financial-system/fixed-assets/run-depreciation', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const period = String(req.body.period || '').trim();
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: 'period must be YYYY-MM' });
    }
    await assertPeriodOpen(`${period}-01`);

    const { rows: assets } = await query(
      `SELECT * FROM fixed_assets WHERE status = 'active'`
    );

    const results = [];
    for (const asset of assets) {
      const monthly = round2((parseFloat(asset.purchase_cost) - parseFloat(asset.salvage_value)) / asset.useful_life_months);
      if (!(monthly > 0.009)) continue;

      // Check if already posted
      const { rows: existing } = await query(
        `SELECT id FROM fixed_asset_depreciation WHERE asset_id = $1 AND period_month = $2`,
        [asset.id, period]
      );
      if (existing.length) continue;

      // Get prior accumulated
      const { rows: prior } = await query(
        `SELECT accumulated FROM fixed_asset_depreciation WHERE asset_id = $1 ORDER BY period_month DESC LIMIT 1`,
        [asset.id]
      );
      const prevAccum = round2(parseFloat(prior[0]?.accumulated) || 0);
      const maxDepreciable = round2(parseFloat(asset.purchase_cost) - parseFloat(asset.salvage_value));
      const remaining = round2(maxDepreciable - prevAccum);
      if (remaining <= 0.009) {
        // Fully depreciated — mark it
        await query(`UPDATE fixed_assets SET status = 'fully_depreciated', updated_at = NOW() WHERE id = $1 AND status = 'active'`, [asset.id]);
        continue;
      }
      const amount = round2(Math.min(monthly, remaining));
      const accumulated = round2(prevAccum + amount);
      const book_value = round2(parseFloat(asset.purchase_cost) - accumulated);

      const { rows: inserted } = await query(
        `INSERT INTO fixed_asset_depreciation (asset_id, period_month, amount, accumulated, book_value)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [asset.id, period, amount, accumulated, book_value]
      );
      results.push({ asset_code: asset.asset_code, name: asset.name, amount, accumulated, book_value, entry: inserted[0] });
    }

    res.json({ period, processed: results.length, skipped: assets.length - results.length, results });
  } catch (e) {
    next(e);
  }
});

// ─── AP / Vendor routes ───────────────────────────────────────────

router.get('/financial-system/vendors', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT v.*,
              COALESCE(ap.outstanding, 0)::float AS outstanding
       FROM vendors v
       LEFT JOIN LATERAL (
         SELECT SUM(net_payable)::float AS outstanding
         FROM vendor_invoices
         WHERE vendor_id = v.id AND status IN ('pending', 'approved')
       ) ap ON TRUE
       ORDER BY v.name`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/financial-system/vendors', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { name, tax_id, category, payment_terms_days, contact_name, contact_phone, contact_email, bank_name, bank_account, notes, wht_rate_pct } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    const { rows } = await query(
      `INSERT INTO vendors (name, tax_id, category, payment_terms_days, contact_name, contact_phone, contact_email, bank_name, bank_account, notes, wht_rate_pct, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        String(name).trim(),
        tax_id || null,
        category || 'general',
        parseInt(payment_terms_days, 10) || 30,
        contact_name || null,
        contact_phone || null,
        contact_email || null,
        bank_name || null,
        bank_account || null,
        notes || null,
        parseFloat(wht_rate_pct) >= 0 ? parseFloat(wht_rate_pct) : 3,
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.put('/financial-system/vendors/:id', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { name, tax_id, category, payment_terms_days, contact_name, contact_phone, contact_email, bank_name, bank_account, notes, wht_rate_pct, is_active } = req.body;
    const { rows } = await query(
      `UPDATE vendors SET
         name = COALESCE($2, name),
         tax_id = COALESCE($3, tax_id),
         category = COALESCE($4, category),
         payment_terms_days = COALESCE($5, payment_terms_days),
         contact_name = COALESCE($6, contact_name),
         contact_phone = COALESCE($7, contact_phone),
         contact_email = COALESCE($8, contact_email),
         bank_name = COALESCE($9, bank_name),
         bank_account = COALESCE($10, bank_account),
         notes = COALESCE($11, notes),
         wht_rate_pct = COALESCE($12, wht_rate_pct),
         is_active = COALESCE($13, is_active),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        req.params.id,
        name || null,
        tax_id !== undefined ? tax_id : null,
        category || null,
        payment_terms_days != null ? parseInt(payment_terms_days, 10) : null,
        contact_name !== undefined ? contact_name : null,
        contact_phone !== undefined ? contact_phone : null,
        contact_email !== undefined ? contact_email : null,
        bank_name !== undefined ? bank_name : null,
        bank_account !== undefined ? bank_account : null,
        notes !== undefined ? notes : null,
        wht_rate_pct != null ? parseFloat(wht_rate_pct) : null,
        is_active != null ? is_active : null,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Vendor not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/vendor-invoices', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const params = [];
    let where = 'TRUE';
    if (req.query.status) {
      params.push(req.query.status);
      where += ` AND vi.status = $${params.length}`;
    }
    if (req.query.vendor_id) {
      params.push(req.query.vendor_id);
      where += ` AND vi.vendor_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT vi.*, v.name AS vendor_name
       FROM vendor_invoices vi
       JOIN vendors v ON v.id = vi.vendor_id
       WHERE ${where}
       ORDER BY vi.created_at DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/financial-system/vendor-invoices', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { vendor_id, invoice_number, invoice_date, amount, description, category, unit_id, notes } = req.body;
    if (!vendor_id) return res.status(400).json({ error: 'vendor_id is required' });
    const amt = parseFloat(amount);
    if (!(amt > 0)) return res.status(400).json({ error: 'amount must be positive' });
    const date = invoice_date || new Date().toISOString().slice(0, 10);
    await assertPeriodOpen(date);

    const { rows: vendorRows } = await query(`SELECT * FROM vendors WHERE id = $1`, [vendor_id]);
    if (!vendorRows[0]) return res.status(404).json({ error: 'Vendor not found' });
    const vendor = vendorRows[0];

    const whtPct = parseFloat(vendor.wht_rate_pct) || 0;
    const whtAmount = round2(amt * whtPct / 100);
    const netPayable = round2(amt - whtAmount);
    const termsDays = parseInt(vendor.payment_terms_days, 10) || 30;
    const dueDate = new Date(new Date(date).getTime() + termsDays * 86400000).toISOString().slice(0, 10);

    const { rows } = await query(
      `INSERT INTO vendor_invoices
         (vendor_id, invoice_number, invoice_date, due_date, amount, wht_amount, net_payable, description, category, unit_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [vendor_id, invoice_number || null, date, dueDate, amt, whtAmount, netPayable, description || null, category || vendor.category, unit_id || null, notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.post('/financial-system/vendor-invoices/:id/approve', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE vendor_invoices SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Invoice not found or not pending' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/vendor-invoices/:id/reject', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE vendor_invoices SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(400).json({ error: 'Invoice not found or not pending' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/vendor-invoices/:id/pay', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { payment_method, payment_reference } = req.body;
    const { rows: existing } = await query(`SELECT * FROM vendor_invoices WHERE id = $1`, [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Invoice not found' });
    if (existing[0].status === 'paid') return res.json(existing[0]);
    if (existing[0].status !== 'approved') return res.status(400).json({ error: 'Invoice must be approved before paying' });
    await assertPeriodOpen(existing[0].invoice_date);
    const { rows } = await query(
      `UPDATE vendor_invoices SET
         status = 'paid', paid_at = NOW(), paid_by = $2,
         payment_method = $3, payment_reference = $4, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, req.user.id, payment_method || null, payment_reference || null]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.get('/financial-system/vendor-aging', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await query(
      `SELECT vi.*, v.name AS vendor_name
       FROM vendor_invoices vi
       JOIN vendors v ON v.id = vi.vendor_id
       WHERE vi.status IN ('pending', 'approved')
       ORDER BY vi.due_date`
    );

    const buckets = {
      current: { label: 'Current (0-30)', amount: 0, count: 0, rows: [] },
      '31_60': { label: '31-60 days', amount: 0, count: 0, rows: [] },
      '61_90': { label: '61-90 days', amount: 0, count: 0, rows: [] },
      '90_plus': { label: '90+ days', amount: 0, count: 0, rows: [] },
    };

    for (const inv of rows) {
      const due = new Date(inv.due_date);
      const diffDays = Math.floor((new Date(today) - due) / 86400000);
      const amt = parseFloat(inv.net_payable) || 0;
      const row = {
        invoice_id: inv.id,
        vendor_name: inv.vendor_name,
        invoice_number: inv.invoice_number,
        due_date: inv.due_date,
        days: Math.max(0, diffDays),
        amount: round2(amt),
        status: inv.status,
      };
      let bucket;
      if (diffDays <= 30) bucket = 'current';
      else if (diffDays <= 60) bucket = '31_60';
      else if (diffDays <= 90) bucket = '61_90';
      else bucket = '90_plus';
      buckets[bucket].amount = round2(buckets[bucket].amount + amt);
      buckets[bucket].count += 1;
      buckets[bucket].rows.push(row);
    }

    const totalOutstanding = round2(rows.reduce((s, r) => s + (parseFloat(r.net_payable) || 0), 0));
    res.json({ as_of: today, total_outstanding: totalOutstanding, buckets });
  } catch (e) {
    if (e.code === '42P01') return res.json({ as_of: new Date().toISOString().slice(0, 10), total_outstanding: 0, buckets: {} });
    next(e);
  }
});

router.get('/financial-system/payment-runs', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pr.*,
              su.full_name AS created_by_name
       FROM payment_runs pr
       LEFT JOIN staff_users su ON su.id = pr.created_by
       ORDER BY pr.created_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/financial-system/payment-runs', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { invoice_ids, notes } = req.body;
    if (!Array.isArray(invoice_ids) || !invoice_ids.length) {
      return res.status(400).json({ error: 'invoice_ids array is required' });
    }
    const { rows: invoices } = await query(
      `SELECT * FROM vendor_invoices WHERE id = ANY($1::int[]) AND status = 'approved'`,
      [invoice_ids]
    );
    if (!invoices.length) return res.status(400).json({ error: 'No approved invoices found' });

    let totalAmount = 0, totalWht = 0, totalNet = 0;
    for (const inv of invoices) {
      totalAmount += parseFloat(inv.amount) || 0;
      totalWht += parseFloat(inv.wht_amount) || 0;
      totalNet += parseFloat(inv.net_payable) || 0;
    }

    const runDate = new Date().toISOString().slice(0, 10);
    await assertPeriodOpen(runDate);

    const { rows: runRows } = await query(
      `INSERT INTO payment_runs (run_date, total_amount, total_wht, total_net, invoice_count, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [runDate, round2(totalAmount), round2(totalWht), round2(totalNet), invoices.length, notes || null, req.user.id]
    );
    const run = runRows[0];

    for (const inv of invoices) {
      await query(
        `INSERT INTO payment_run_items (run_id, invoice_id, amount, wht_amount, net_payable)
         VALUES ($1,$2,$3,$4,$5)`,
        [run.id, inv.id, inv.amount, inv.wht_amount, inv.net_payable]
      );
    }

    res.status(201).json(run);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.post('/financial-system/payment-runs/:id/confirm', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { rows: runRows } = await query(`SELECT * FROM payment_runs WHERE id = $1`, [req.params.id]);
    if (!runRows[0]) return res.status(404).json({ error: 'Payment run not found' });
    if (runRows[0].status === 'completed') return res.json(runRows[0]);
    if (runRows[0].status !== 'draft') return res.status(400).json({ error: 'Run must be in draft status' });

    await assertPeriodOpen(runRows[0].run_date);

    const { rows: items } = await query(
      `SELECT invoice_id FROM payment_run_items WHERE run_id = $1`,
      [req.params.id]
    );
    const invoiceIds = items.map((i) => i.invoice_id);
    if (invoiceIds.length) {
      await query(
        `UPDATE vendor_invoices SET status = 'paid', paid_at = NOW(), paid_by = $2, updated_at = NOW()
         WHERE id = ANY($1::int[]) AND status = 'approved'`,
        [invoiceIds, req.user.id]
      );
    }

    const { rows } = await query(
      `UPDATE payment_runs SET status = 'completed' WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

// ─── AR Controls ───────────────────────────────────────────────────

router.get('/financial-system/ar-actions', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const reservationId = req.query.reservation_id ? parseInt(req.query.reservation_id, 10) : null;
    const params = [];
    let where = '1=1';
    if (reservationId) {
      params.push(reservationId);
      where = `a.reservation_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT a.*, su.full_name AS created_by_name
       FROM ar_collection_actions a
       LEFT JOIN staff_users su ON su.id = a.created_by
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/financial-system/ar-actions', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { reservation_id, action_type, notes, next_action_date, amount_disputed } = req.body;
    if (!reservation_id || !action_type) {
      return res.status(400).json({ error: 'reservation_id and action_type are required' });
    }
    const { rows } = await query(
      `INSERT INTO ar_collection_actions (reservation_id, action_type, notes, next_action_date, amount_disputed, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        reservation_id,
        action_type,
        notes || null,
        next_action_date || null,
        parseFloat(amount_disputed) || 0,
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/ar-provisions', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, su.full_name AS created_by_name
       FROM ar_bad_debt_provisions p
       LEFT JOIN staff_users su ON su.id = p.created_by
       ORDER BY p.period_month DESC`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/financial-system/ar-provisions', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { period_month, bucket_0_30_pct, bucket_31_60_pct, bucket_61_90_pct, bucket_90_plus_pct, notes } = req.body;
    if (!period_month || !/^\d{4}-\d{2}$/.test(period_month)) {
      return res.status(400).json({ error: 'period_month must be YYYY-MM' });
    }
    const pct030 = parseFloat(bucket_0_30_pct) || 0;
    const pct3160 = parseFloat(bucket_31_60_pct) || 1;
    const pct6190 = parseFloat(bucket_61_90_pct) || 5;
    const pct90 = parseFloat(bucket_90_plus_pct) || 20;

    // Load aging data for the period
    const to = `${period_month}-${new Date(Number(period_month.slice(0, 4)), Number(period_month.slice(5, 7)), 0).getDate()}`;
    const built = await buildFinancialPortal(FINANCIAL_EPOCH, to);
    const aging = agingFromReservations(built.reservations, to);
    const buckets = aging.buckets || {};

    const b030 = buckets.current?.amount || 0;
    const b3160 = buckets.d31?.amount || 0;
    const b6190 = buckets.d61?.amount || 0;
    const b90 = buckets.d90?.amount || 0;
    const totalAr = round2(b030 + b3160 + b6190 + b90);
    const totalProvision = round2(
      (b030 * pct030 / 100) +
      (b3160 * pct3160 / 100) +
      (b6190 * pct6190 / 100) +
      (b90 * pct90 / 100)
    );

    const { rows } = await query(
      `INSERT INTO ar_bad_debt_provisions
         (period_month, bucket_0_30_pct, bucket_31_60_pct, bucket_61_90_pct, bucket_90_plus_pct, total_ar, total_provision, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (period_month) DO UPDATE SET
         bucket_0_30_pct = $2, bucket_31_60_pct = $3, bucket_61_90_pct = $4, bucket_90_plus_pct = $5,
         total_ar = $6, total_provision = $7, notes = $8, created_by = $9
       RETURNING *`,
      [period_month, pct030, pct3160, pct6190, pct90, totalAr, totalProvision, notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/ar-provisions/:month', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, su.full_name AS created_by_name
       FROM ar_bad_debt_provisions p
       LEFT JOIN staff_users su ON su.id = p.created_by
       WHERE p.period_month = $1`,
      [req.params.month]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Provision not found for this month' });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '42P01') return res.status(404).json({ error: 'Provision not found' });
    next(e);
  }
});

router.get('/financial-system/ar-write-offs', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT w.*,
              su.full_name AS created_by_name,
              ap.full_name AS approved_by_name
       FROM ar_write_offs w
       LEFT JOIN staff_users su ON su.id = w.created_by
       LEFT JOIN staff_users ap ON ap.id = w.approved_by
       ORDER BY w.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/financial-system/ar-write-offs', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { reservation_id, amount, reason } = req.body;
    if (!reservation_id || !(parseFloat(amount) > 0)) {
      return res.status(400).json({ error: 'reservation_id and a positive amount are required' });
    }
    const { rows } = await query(
      `INSERT INTO ar_write_offs (reservation_id, amount, reason, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [reservation_id, round2(parseFloat(amount)), reason || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/ar-write-offs/:id/approve', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE ar_write_offs SET status = 'approved', approved_by = $2, approved_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Write-off not found or not pending' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/financial-system/ar-write-offs/:id/reject', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `UPDATE ar_write_offs SET status = 'rejected', approved_by = $2, approved_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Write-off not found or not pending' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/ar-dashboard', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to);
    const asOf = to || new Date().toISOString().slice(0, 10);
    const aging = agingFromReservations(built.reservations, asOf);

    // Latest provision
    let latestProvision = null;
    try {
      const { rows } = await query(
        `SELECT * FROM ar_bad_debt_provisions ORDER BY period_month DESC LIMIT 1`
      );
      latestProvision = rows[0] || null;
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }

    // Collection action counts
    let actionCounts = {};
    let actionsThisMonth = 0;
    try {
      const { rows } = await query(
        `SELECT action_type, COUNT(*)::int AS cnt FROM ar_collection_actions GROUP BY action_type`
      );
      for (const r of rows) actionCounts[r.action_type] = r.cnt;
      const currentMonth = asOf.slice(0, 7);
      const { rows: monthRows } = await query(
        `SELECT COUNT(*)::int AS cnt FROM ar_collection_actions WHERE to_char(created_at, 'YYYY-MM') = $1`,
        [currentMonth]
      );
      actionsThisMonth = monthRows[0]?.cnt || 0;
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }

    // Write-off totals
    let writeOffTotals = { pending: 0, approved: 0, rejected: 0, pending_count: 0, approved_count: 0 };
    try {
      const { rows } = await query(
        `SELECT status, COUNT(*)::int AS cnt, COALESCE(SUM(amount), 0)::float AS total
         FROM ar_write_offs GROUP BY status`
      );
      for (const r of rows) {
        writeOffTotals[r.status] = round2(r.total);
        writeOffTotals[`${r.status}_count`] = r.cnt;
      }
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }

    // Overdue count (> 30 days)
    const overdueCount =
      (aging.buckets?.d31?.count || 0) +
      (aging.buckets?.d61?.count || 0) +
      (aging.buckets?.d90?.count || 0);

    res.json({
      aging,
      total_ar: aging.total,
      total_provision: round2(parseFloat(latestProvision?.total_provision) || 0),
      latest_provision: latestProvision,
      overdue_count: overdueCount,
      overdue_pct: aging.total > 0 ? round2((overdueCount / (aging.buckets?.current?.count || 1 + overdueCount)) * 100) : 0,
      action_counts: actionCounts,
      actions_this_month: actionsThisMonth,
      write_offs: writeOffTotals,
    });
  } catch (e) {
    next(e);
  }
});

// ─── Close Checklist ──────────────────────────────────────────────

router.get('/financial-system/close-checklist/:month', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const month = String(req.params.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });

    // Check if items exist for this month
    let { rows: items } = await query(
      `SELECT ci.*, ct.task_order, ct.required_before_close
       FROM close_checklist_items ci
       LEFT JOIN close_checklist_templates ct ON ct.id = ci.template_id
       WHERE ci.period_month = $1
       ORDER BY ct.task_order, ci.id`,
      [month]
    );

    // Auto-create from templates if none exist
    if (!items.length) {
      const { rows: templates } = await query(
        `SELECT * FROM close_checklist_templates ORDER BY task_order`
      );
      for (const t of templates) {
        await query(
          `INSERT INTO close_checklist_items (period_month, template_id, title, description, owner_role)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (period_month, template_id) DO NOTHING`,
          [month, t.id, t.title, t.description, t.owner_role]
        );
      }
      const result = await query(
        `SELECT ci.*, ct.task_order, ct.required_before_close
         FROM close_checklist_items ci
         LEFT JOIN close_checklist_templates ct ON ct.id = ci.template_id
         WHERE ci.period_month = $1
         ORDER BY ct.task_order, ci.id`,
        [month]
      );
      items = result.rows;
    }

    res.json({ month, items });
  } catch (e) {
    if (e.code === '42P01') return res.json({ month: req.params.month, items: [] });
    next(e);
  }
});

router.post('/financial-system/close-checklist/:month/:itemId', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { status, evidence_notes } = req.body;
    const allowed = ['pending', 'in_progress', 'done', 'skipped'];
    if (status && !allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const updateParams = [req.params.itemId, req.params.month];
    const updateSets = [];
    if (status) {
      updateParams.push(status);
      updateSets.push(`status = $${updateParams.length}`);
      if (status === 'done') {
        updateParams.push(req.user.id);
        updateSets.push(`completed_by = $${updateParams.length}`);
        updateSets.push(`completed_at = NOW()`);
      }
    }
    if (evidence_notes !== undefined) {
      updateParams.push(evidence_notes);
      updateSets.push(`evidence_notes = $${updateParams.length}`);
    }
    if (!updateSets.length) return res.status(400).json({ error: 'Nothing to update' });

    const { rows: updated } = await query(
      `UPDATE close_checklist_items SET ${updateSets.join(', ')} WHERE id = $1 AND period_month = $2 RETURNING *`,
      updateParams
    );
    if (!updated[0]) return res.status(404).json({ error: 'Checklist item not found' });
    res.json(updated[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/financial-system/close-checklist-templates', requireRoles('admin', 'finance', 'finance_manager'), async (_req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM close_checklist_templates ORDER BY task_order`);
    res.json(rows);
  } catch (e) {
    if (e.code === '42P01') return res.json([]);
    next(e);
  }
});

router.post('/financial-system/close-checklist-templates', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { id, task_order, title, description, owner_role, required_before_close } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (id) {
      const { rows } = await query(
        `UPDATE close_checklist_templates SET task_order = COALESCE($2, task_order), title = COALESCE($3, title),
         description = $4, owner_role = $5, required_before_close = COALESCE($6, required_before_close)
         WHERE id = $1 RETURNING *`,
        [id, task_order, title, description || null, owner_role || null, required_before_close]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Template not found' });
      return res.json(rows[0]);
    }
    const { rows } = await query(
      `INSERT INTO close_checklist_templates (task_order, title, description, owner_role, required_before_close)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [task_order || 99, title, description || null, owner_role || null, required_before_close !== false]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// ─── Segment P&L ──────────────────────────────────────────────────

router.get('/financial-system/segment-pnl', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to);
    const reservations = built.reservations || [];

    const projects = {};
    for (const r of reservations) {
      if (String(r.status || '').toLowerCase() === 'cancelled') continue;
      const project = r.project || 'Unassigned';
      if (!projects[project]) {
        projects[project] = {
          project,
          gross_revenue: 0,
          owner_share: 0,
          commission: 0,
          direct_costs: 0,
          count: 0,
        };
      }
      const fin = calcReservationFinancials(r, r);
      const split = bookingSplit(fin, r);
      const p = projects[project];
      p.gross_revenue += parseFloat(r.total_amount) || 0;
      p.owner_share += Number(fin.ownerNet) || 0;
      p.commission += Number(fin.companyCommission) || 0;
      p.count += 1;
    }

    const opexTotal = built.kpis?.opex || 0;
    const totalRevenue = Object.values(projects).reduce((s, p) => s + p.gross_revenue, 0) || 1;

    const segments = Object.values(projects).map((p) => {
      const netRevenue = round2(p.gross_revenue - p.owner_share);
      const opexAlloc = round2(opexTotal * (p.gross_revenue / totalRevenue));
      const netProfit = round2(netRevenue - p.direct_costs - opexAlloc);
      return {
        project: p.project,
        reservation_count: p.count,
        gross_revenue: round2(p.gross_revenue),
        owner_share: round2(p.owner_share),
        net_revenue: netRevenue,
        direct_costs: round2(p.direct_costs),
        opex_allocation: opexAlloc,
        net_profit: netProfit,
      };
    }).sort((a, b) => b.gross_revenue - a.gross_revenue);

    const consolidated = {
      project: 'Consolidated',
      reservation_count: segments.reduce((s, p) => s + p.reservation_count, 0),
      gross_revenue: round2(segments.reduce((s, p) => s + p.gross_revenue, 0)),
      owner_share: round2(segments.reduce((s, p) => s + p.owner_share, 0)),
      net_revenue: round2(segments.reduce((s, p) => s + p.net_revenue, 0)),
      direct_costs: round2(segments.reduce((s, p) => s + p.direct_costs, 0)),
      opex_allocation: round2(opexTotal),
      net_profit: round2(segments.reduce((s, p) => s + p.net_profit, 0)),
    };

    res.json({ from_date: from, to_date: to, segments, consolidated });
  } catch (e) {
    next(e);
  }
});

// ─── Cash Forecast ────────────────────────────────────────────────

router.get('/financial-system/cash-forecast', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - ((dayOfWeek + 6) % 7));

    const weeks = [];
    for (let i = 0; i < 13; i++) {
      const ws = new Date(weekStart);
      ws.setDate(weekStart.getDate() + i * 7);
      weeks.push(ws.toISOString().slice(0, 10));
    }

    const lastWeek = new Date(weekStart);
    lastWeek.setDate(weekStart.getDate() + 12 * 7 + 6);

    // Auto-populate collections from upcoming check-ins
    const { rows: checkins } = await query(
      `SELECT to_char(r.check_in, 'YYYY-MM-DD') AS check_in, SUM(r.total_amount)::float AS total
       FROM reservations r
       WHERE r.status <> 'cancelled'
         AND r.check_in >= $1::date AND r.check_in <= $2::date
       GROUP BY to_char(r.check_in, 'YYYY-MM-DD')`,
      [weeks[0], lastWeek.toISOString().slice(0, 10)]
    );

    // Auto-populate recurring
    let recurring = [];
    try {
      const { rows } = await query(
        `SELECT kind, amount_egp, day_of_month FROM financial_recurring_charges WHERE is_active = 1`
      );
      recurring = rows;
    } catch (_) {}

    // Load manual entries
    let manualEntries = [];
    try {
      const { rows } = await query(
        `SELECT * FROM cash_forecast_entries WHERE week_start >= $1::date AND week_start <= $2::date ORDER BY week_start`,
        [weeks[0], lastWeek.toISOString().slice(0, 10)]
      );
      manualEntries = rows;
    } catch (_) {}

    // Get starting balance (treasury total)
    const { from, to } = dateRange(req);
    const built = await buildFinancialPortal(from, to || new Date().toISOString().slice(0, 10));
    const startingBalance = round2((built.treasury || []).reduce((s, t) => s + (t.balance || 0), 0));

    const forecast = weeks.map((ws) => {
      const weekEnd = new Date(new Date(ws).getTime() + 6 * 86400000).toISOString().slice(0, 10);

      // Collections from check-ins in this week
      let collections = 0;
      for (const ci of checkins) {
        if (ci.check_in >= ws && ci.check_in <= weekEnd) {
          collections += Number(ci.total) || 0;
        }
      }

      // Recurring charges due this week
      let recurringAmt = 0;
      for (const rec of recurring) {
        const day = parseInt(rec.day_of_month, 10) || 1;
        const monthStart = ws.slice(0, 7);
        const dueDate = `${monthStart}-${String(Math.min(day, 28)).padStart(2, '0')}`;
        if (dueDate >= ws && dueDate <= weekEnd) {
          recurringAmt += Number(rec.amount_egp) || 0;
        }
      }

      // Manual entries for this week
      const weekManuals = manualEntries.filter((e) => e.week_start === ws);
      const manualByCategory = {};
      for (const m of weekManuals) {
        manualByCategory[m.category] = (manualByCategory[m.category] || 0) + (Number(m.amount) || 0);
      }

      const ownerPayouts = manualByCategory.owner_payouts || 0;
      const vendorPayments = manualByCategory.vendor_payments || 0;
      const payroll = manualByCategory.payroll || 0;
      const tax = manualByCategory.tax || 0;
      const otherIn = manualByCategory.other_in || 0;
      const otherOut = manualByCategory.other_out || 0;

      const totalIn = round2(collections + otherIn + (manualByCategory.collections || 0));
      const totalOut = round2(ownerPayouts + vendorPayments + recurringAmt + payroll + tax + otherOut);
      const netFlow = round2(totalIn - totalOut);

      return {
        week_start: ws,
        week_end: weekEnd,
        collections: round2(collections + (manualByCategory.collections || 0)),
        owner_payouts: round2(ownerPayouts),
        vendor_payments: round2(vendorPayments),
        recurring: round2(recurringAmt + (manualByCategory.recurring || 0)),
        payroll: round2(payroll),
        tax: round2(tax),
        other_in: round2(otherIn),
        other_out: round2(otherOut),
        net_flow: netFlow,
        manual_entries: weekManuals,
      };
    });

    // Add cumulative balance
    let cumulative = startingBalance;
    for (const week of forecast) {
      cumulative = round2(cumulative + week.net_flow);
      week.cumulative_balance = cumulative;
    }

    res.json({ starting_balance: startingBalance, weeks: forecast });
  } catch (e) {
    if (e.code === '42P01') return res.json({ starting_balance: 0, weeks: [] });
    next(e);
  }
});

router.post('/financial-system/cash-forecast', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { week_start, category, amount, notes } = req.body;
    if (!week_start || !category) return res.status(400).json({ error: 'week_start and category are required' });
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt)) return res.status(400).json({ error: 'amount must be a number' });
    const { rows } = await query(
      `INSERT INTO cash_forecast_entries (week_start, category, amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [week_start, category, amt, notes || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.delete('/financial-system/cash-forecast/:id', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const { rows } = await query(`DELETE FROM cash_forecast_entries WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Entry not found' });
    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    next(e);
  }
});

// ─── Tax Filing Pack ──────────────────────────────────────────────

router.get('/financial-system/tax-filing-pack/:month', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const month = String(req.params.month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'month must be YYYY-MM' });
    const from = `${month}-01`;
    const to = lastDayOfMonth(month);
    const built = await buildFinancialPortal(from, to);
    const reservations = built.reservations || [];

    // VAT output breakdown
    let commissionBase = 0;
    for (const r of reservations) {
      if (String(r.status || '').toLowerCase() === 'cancelled') continue;
      const fin = calcReservationFinancials(r, r);
      commissionBase += Number(fin.companyCommission) || 0;
    }
    const commissionVat = round2(commissionBase * VAT_OUTPUT_PCT / 100);
    const totalOutputVat = commissionVat;

    // VAT input breakdown by category
    const expParams = [from, to];
    let expenses = [];
    try {
      const { rows } = await query(
        `SELECT id, description, amount, category, expense_date
         FROM expenses WHERE created_at::date >= $1::date AND created_at::date <= $2::date
           AND COALESCE(paid_by, 'company') <> 'owner'`,
        expParams
      );
      expenses = rows;
    } catch (_) {}

    const inputCategories = { rent: 0, professional: 0, software: 0 };
    const whtLines = [];
    for (const e of expenses) {
      const amt = parseFloat(e.amount) || 0;
      if (['rent', 'professional', 'software'].includes(e.category)) {
        inputCategories[e.category] = round2((inputCategories[e.category] || 0) + round2((amt * VAT_OUTPUT_PCT) / (100 + VAT_OUTPUT_PCT)));
      }
      const whtRate = e.category === 'professional' ? 1 : 3;
      whtLines.push({
        expense_id: e.id,
        vendor: e.description || 'Vendor',
        amount: round2(amt),
        wht_rate_pct: whtRate,
        wht_amount: round2(amt * whtRate / 100),
        date: e.expense_date,
        category: e.category,
      });
    }

    // Recurring input VAT
    let recurring = [];
    try {
      const { rows } = await query(`SELECT kind, amount_egp FROM financial_recurring_charges WHERE is_active = 1`);
      recurring = rows;
    } catch (_) {}
    for (const rec of recurring) {
      if (rec.kind === 'rent') {
        const amt = Number(rec.amount_egp) || 0;
        const cat = rec.kind;
        inputCategories[cat] = round2((inputCategories[cat] || 0) + round2((amt * VAT_OUTPUT_PCT) / (100 + VAT_OUTPUT_PCT)));
      }
    }

    const totalInputVat = round2(Object.values(inputCategories).reduce((s, v) => s + v, 0));
    const netVatPayable = round2(totalOutputVat - totalInputVat);
    const totalWht = round2(whtLines.reduce((s, l) => s + l.wht_amount, 0));

    // Book balances for reconciliation
    const vatReturn = built.journal ? (() => {
      let output = 0, input = 0;
      for (const e of built.journal) {
        for (const line of e.lines) {
          if (line.account === '205000') output += (line.credit || 0) - (line.debit || 0);
          if (line.account === '107000') input += (line.debit || 0) - (line.credit || 0);
        }
      }
      return { output: round2(output), input: round2(input) };
    })() : { output: 0, input: 0 };

    res.json({
      month,
      from_date: from,
      to_date: to,
      vat_output: {
        commission_base: round2(commissionBase),
        commission_vat: commissionVat,
        total: totalOutputVat,
        rate_pct: VAT_OUTPUT_PCT,
      },
      vat_input: {
        by_category: inputCategories,
        total: totalInputVat,
      },
      net_vat_payable: netVatPayable,
      wht: {
        lines: whtLines,
        total: totalWht,
      },
      reconciliation: {
        book_output_vat: vatReturn.output,
        computed_output_vat: totalOutputVat,
        output_diff: round2(vatReturn.output - totalOutputVat),
        book_input_vat: vatReturn.input,
        computed_input_vat: totalInputVat,
        input_diff: round2(vatReturn.input - totalInputVat),
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
