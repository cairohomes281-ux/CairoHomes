const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { calcReservationFinancials, calcStatementFinancials, ownerPortalFinancials, round2 } = require('../../lib/commission');
const { FINANCIAL_EPOCH, clampFromDate } = require('../../lib/financialEpoch');
const { logAudit } = require('../../lib/audit');

const router = express.Router();

async function ownerUnitIds(ownerId) {
  const { rows } = await query(`SELECT unit_id FROM owner_units WHERE owner_id = $1`, [ownerId]);
  return rows.map((r) => r.unit_id);
}


router.get('/reports/owner-statement', requireRoles('owner', 'admin', 'finance', 'finance_manager', 'owners_relations', 'unit_acquisition_manager'), async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const to = req.query.to_date || null;
    const isOwner = req.user.role === 'owner';

    let unitId = req.query.unit_id || null;
    if (isOwner) {
      const allowed = await ownerUnitIds(req.user.id);
      if (unitId && !allowed.includes(unitId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!unitId && allowed.length === 1) unitId = allowed[0];
      if (!unitId) {
        return res.json({
          lines: [],
          totals: { gross: 0, commission: 0, net: 0 },
          summary: {},
          reservations: [],
          expenses: [],
          unit: null,
        });
      }
    }
    if (!unitId) {
      return res.status(400).json({ error: 'unit_id required' });
    }

    const { rows: units } = await query(`SELECT * FROM units WHERE id = $1`, [unitId]);
    const unit = units[0];
    if (!unit) return res.status(404).json({ error: 'Unit not found' });

    const params = [unitId, from];
    let where = `r.unit_id = $1 AND r.status <> 'cancelled' AND r.check_in >= $2::date`;
    if (to) {
      params.push(to);
      where += ` AND r.check_in <= $${params.length}::date`;
    }

    const { rows: reservations } = await query(
      `SELECT r.* FROM reservations r WHERE ${where} ORDER BY r.check_in`,
      params
    );

    const statement = calcStatementFinancials(unit, reservations);
    const reservationRows = statement.rows.map((r) => {
      const fin = r._fin;
      const base = {
        id: r.id,
        check_in: r.check_in,
        check_out: r.check_out,
        nights: r.nights,
        is_owner_reservation: r.is_owner_reservation,
        intermediate_price_per_night: fin.intermediatePricePerNight,
        subtotal: fin.subtotal,
        company_commission_amount: fin.companyCommission,
        adjusted_total: fin.ownerNet,
        applied_commission_pct: fin.appliedCommissionPct,
        booking_ref: `SH-${r.id}`,
        gross: fin.grossAmount,
        commission: fin.companyCommission,
        net: fin.ownerNet,
        status: r.status,
        payment_status: r.payment_status,
      };
      
      if (!isOwner) {
        return {
          ...base,
          guest_name: r.guest_name,
          guest_email: r.guest_email,
          guest_phone: r.guest_phone,
        };
      }
      return base;
    });

    const expParams = [unitId, from];
    let expWhere = `expense_date >= $2::date AND (
         unit_id = $1
         OR (
           paid_by = 'owner'
           AND owner_id IN (SELECT owner_id FROM owner_units WHERE unit_id = $1)
           AND unit_id IS NULL
         )
       )`;
    if (to) {
      expParams.push(to);
      expWhere += ` AND expense_date <= $${expParams.length}::date`;
    }
    const { rows: expenses } = await query(
      `SELECT id, description, amount, paid_by, expense_date, notes, owner_id, unit_id
       FROM expenses WHERE ${expWhere} ORDER BY expense_date`,
      expParams
    );

    
    const ownerExpTotal = expenses
      .filter((e) => e.paid_by === 'owner')
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    const finalDue = round2(statement.totalOwnerNet - ownerExpTotal);

    const summary = {
      commissionMode: unit.commission_mode || 'A',
      companyCommissionPct: Number(unit.company_commission_pct) || 0,
      tenantCommissionPct: Number(unit.commission_tenant_pct) || 0,
      totalGross: statement.totalGross,
      totalTenantDeduction: statement.totalTenantDeduction,
      totalBrokerDeduction: 0,
      totalSubtotal: statement.totalSubtotal,
      totalCompanyCommission: statement.totalCompanyCommission,
      totalOwnerNet: statement.totalOwnerNet,
      ownerExpenses: round2(ownerExpTotal),
      finalDue,
    };

    res.json({
      unit: {
        id: unit.id,
        name: unit.title,
        title: unit.title,
        project: unit.project || unit.compound,
        owner_name: isOwner ? undefined : unit.owner_name,
        unit_number: unit.unit_number,
      },
      summary,
      reservations: reservationRows,
      expenses,
      lines: reservationRows,
      totals: {
        gross: statement.totalGross,
        commission: statement.totalCompanyCommission,
        net: statement.totalOwnerNet,
      },
      from,
      to,
      financial_epoch: FINANCIAL_EPOCH,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/owner/dashboard', requireRoles('owner', 'admin'), async (req, res, next) => {
  try {
    const ownerId = req.user.role === 'owner' ? req.user.id : Number(req.query.owner_id) || req.user.id;
    const unitIds = await ownerUnitIds(ownerId);
    if (!unitIds.length) {
      return res.json({
        units: [],
        occupancy_pct: 0,
        adr: 0,
        gbv: 0,
        commission: 0,
        owner_net: 0,
        paid: 0,
        pending: 0,
        next_payout_date: null,
        settlements: [],
      });
    }

    const from = clampFromDate(req.query.from_date);
    const { rows: reservations } = await query(
      `SELECT r.*, u.company_commission_pct, u.company_commission_owner_pct,
              u.commission_mode, u.commission_tenant_pct
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE r.unit_id = ANY($1::uuid[])
         AND r.status <> 'cancelled'
         AND r.check_in >= $2::date`,
      [unitIds, from]
    );

    let bookedNights = 0;
    let gbv = 0;
    let commission = 0;
    let ownerNet = 0;
    for (const r of reservations) {
      const nights = Number(r.nights) || 0;
      bookedNights += nights;
      const fin = calcReservationFinancials(r, r);
      gbv += fin.grossAmount;
      commission += fin.companyCommission;
      ownerNet += fin.ownerNet;
    }

    const { rows: unitRows } = await query(
      `SELECT id, title, unit_number, project, compound, status, ops_status
       FROM units WHERE id = ANY($1::uuid[])`,
      [unitIds]
    );

    const unitCount = unitRows.length || 1;
    const rangeStart = new Date(from);
    const rangeEnd = new Date();
    const days = Math.max(1, Math.round((rangeEnd - rangeStart) / 86400000) + 1);
    const availableNights = unitCount * days;
    const occupancy = availableNights > 0 ? bookedNights / availableNights : 0;
    const adr = bookedNights > 0 ? gbv / bookedNights : 0;

    const { rows: settlements } = await query(
      `SELECT * FROM owner_settlements WHERE owner_id = $1 ORDER BY period_end DESC LIMIT 12`,
      [ownerId]
    );
    const ready = settlements.find((s) => s.status === 'ready');
    const paidSum = settlements
      .filter((s) => s.status === 'paid')
      .reduce((s, r) => s + Number(r.net_amount || 0), 0);
    const pendingSum = settlements
      .filter((s) => s.status === 'open' || s.status === 'ready')
      .reduce((s, r) => s + Number(r.net_amount || 0), 0);

    const { rows: expenseRows } = await query(
      `SELECT e.id, e.description, e.amount, e.paid_by, e.expense_date, e.notes, e.owner_id,
              COALESCE(u.unit_number, u.title) AS unit_name
       FROM expenses e
       LEFT JOIN units u ON u.id = e.unit_id
       WHERE e.paid_by = 'owner'
         AND e.expense_date >= $2::date
         AND (
           e.owner_id = $3
           OR (e.owner_id IS NULL AND e.unit_id = ANY($1::uuid[]))
         )
       ORDER BY e.expense_date DESC
       LIMIT 50`,
      [unitIds, from, ownerId]
    );
    const ownerExpensesTotal = expenseRows.reduce((s, e) => s + Number(e.amount || 0), 0);
    const netAfterExpenses = round2(ownerNet - ownerExpensesTotal);

    res.json({
      units: unitRows,
      occupancy_pct: Math.round(occupancy * 1000) / 10,
      adr: round2(adr),
      gbv: round2(gbv),
      commission: round2(commission),
      owner_net: round2(ownerNet),
      owner_expenses: round2(ownerExpensesTotal),
      net_after_expenses: netAfterExpenses,
      expenses: expenseRows,
      paid: round2(paidSum),
      pending: round2(pendingSum || netAfterExpenses),
      next_payout_date: ready?.period_end || null,
      settlements,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/owner/reservations', requireRoles('owner', 'admin'), async (req, res, next) => {
  try {
    const ownerId = req.user.role === 'owner' ? req.user.id : Number(req.query.owner_id) || req.user.id;
    const unitIds = await ownerUnitIds(ownerId);
    if (!unitIds.length) return res.json([]);

    const { rows: reservations } = await query(
      `SELECT r.id, r.check_in, r.check_out, r.nights, r.total_amount, r.status, r.payment_status,
              r.booking_id, u.title AS unit_name, u.unit_number,
              u.company_commission_pct, u.company_commission_owner_pct,
              u.commission_mode, u.commission_tenant_pct,
              r.owner_collected_type, r.owner_collected_amount,
              r.broker_name, r.broker_amount_per_night, r.broker_total,
              r.price_per_night, r.payment_method, r.updated_at, r.created_at
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE r.unit_id = ANY($1::uuid[])
       ORDER BY r.check_in DESC
       LIMIT 200`,
      [unitIds]
    );

    
    const { rows: pendingBookings } = await query(
      `SELECT b.id, b.checkin AS check_in, b.checkout AS check_out, b.total_egp AS total_amount,
              b.status, b.payment_status, b.created_at, b.cancellation_reason,
              u.title AS unit_name, u.unit_number,
              u.company_commission_pct, u.company_commission_owner_pct,
              u.commission_mode, u.commission_tenant_pct, u.property_type
       FROM bookings b
       JOIN units u ON u.id = b.unit_id
       WHERE b.unit_id = ANY($1::uuid[])
         AND (
           (b.status IN ('pending', 'held') AND (b.hold_expires_at IS NULL OR b.hold_expires_at > now()))
           OR b.status = 'cancelled'
         )
         AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.booking_id = b.id)
       ORDER BY b.checkin DESC
       LIMIT 150`,
      [unitIds]
    );

    const mappedReservations = reservations.map((r) => {
      const raw = String(r.status || '').toLowerCase();
      let ownerStatus = 'confirmed';
      if (raw === 'cancelled') ownerStatus = 'rejected';
      else if (raw === 'pending') ownerStatus = 'pending';
      else ownerStatus = 'confirmed'; 

      const unit = {
        company_commission_pct: r.company_commission_pct,
        company_commission_owner_pct: r.company_commission_owner_pct,
        commission_mode: r.commission_mode,
        commission_tenant_pct: r.commission_tenant_pct,
      };
      const fin = ownerPortalFinancials(unit, r, { status: ownerStatus });
      return {
        id: `res-${r.id}`,
        booking_ref: `SH-${r.id}`,
        check_in: r.check_in,
        check_out: r.check_out,
        nights: r.nights,
        status: ownerStatus,
        payment_status: r.payment_status,
        payment_method: r.payment_method || null,
        owner_collected_type: r.owner_collected_type || null,
        owner_collected_amount: r.owner_collected_amount != null ? Number(r.owner_collected_amount) : null,
        broker_name: r.broker_name || null,
        broker_total: r.broker_total != null ? Number(r.broker_total) : null,
        unit_name: r.unit_number || r.unit_name,
        unit_number: r.unit_number,
        gross: fin.showMoney ? fin.gross : null,
        commission: fin.showMoney ? fin.commission : null,
        net: fin.showMoney ? fin.net : null,
        broker_deduction: fin.showMoney ? fin.brokerDeduction || 0 : null,
        commission_pct: fin.commissionPct,
        show_money: fin.showMoney,
        sort_at: r.check_in,
      };
    });

    const mappedBookings = pendingBookings.map((b) => {
      const nights = Math.max(
        1,
        Math.round((new Date(b.check_out) - new Date(b.check_in)) / 86400000)
      );
      const ownerStatus =
        b.status === 'cancelled' || String(b.status).toLowerCase() === 'rejected'
          ? 'rejected'
          : 'pending';
      const unit = {
        company_commission_pct: b.company_commission_pct,
      };
      const fin = ownerPortalFinancials(
        unit,
        {
          nights,
          total_amount: b.total_amount,
        },
        { status: ownerStatus }
      );
      return {
        id: `book-${b.id}`,
        booking_ref: `WB-${String(b.id).slice(0, 8)}`,
        check_in: b.check_in,
        check_out: b.check_out,
        nights,
        status: ownerStatus,
        payment_status: b.payment_status,
        unit_name: b.unit_number || b.unit_name,
        unit_number: b.unit_number,
        gross: fin.showMoney ? fin.gross : null,
        commission: fin.showMoney ? fin.commission : null,
        net: fin.showMoney ? fin.net : null,
        commission_pct: fin.commissionPct,
        show_money: fin.showMoney,
        sort_at: b.check_in,
      };
    });

    const combined = [...mappedBookings, ...mappedReservations].sort(
      (a, b) => new Date(b.sort_at) - new Date(a.sort_at)
    );

    res.json(combined);
  } catch (e) {
    next(e);
  }
});

router.get('/owner/units', requireRoles('owner', 'admin', 'owners_relations'), async (req, res, next) => {
  try {
    if (req.user.role === 'admin' || req.user.role === 'owners_relations') {
      const ownerId = Number(req.query.owner_id);
      const params = [];
      let where = `COALESCE(u.listing_type, 'rent') IN ('rent', 'long_term')`;
      if (Number.isFinite(ownerId) && ownerId > 0) {
        params.push(ownerId);
        where += ` AND EXISTS (
          SELECT 1 FROM owner_units ou WHERE ou.unit_id = u.id AND ou.owner_id = $1
        )`;
      }
      const { rows } = await query(
        `SELECT u.id, u.title, u.unit_number, u.project, u.compound, u.area, u.status, u.ops_status
         FROM units u
         WHERE ${where}
         ORDER BY u.unit_number NULLS LAST, u.title`,
        params
      );
      return res.json(
        rows.map((u) => ({
          ...u,
          name: u.unit_number || u.title,
          project: u.project || u.compound,
        }))
      );
    }

    const ownerId = req.user.id;
    const { rows } = await query(
      `SELECT u.id, u.title, u.unit_number, u.project, u.compound, u.area, u.status, u.ops_status
       FROM owner_units ou
       JOIN units u ON u.id = ou.unit_id
       WHERE ou.owner_id = $1
       ORDER BY u.unit_number NULLS LAST, u.title`,
      [ownerId]
    );
    res.json(
      rows.map((u) => ({
        ...u,
        name: u.unit_number || u.title,
        project: u.project || u.compound,
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.get('/owner/payout-requests', requireRoles('owner', 'admin'), async (req, res, next) => {
  try {
    const ownerId = req.user.role === 'owner' ? req.user.id : Number(req.query.owner_id) || req.user.id;
    const { rows } = await query(
      `SELECT * FROM owner_payout_requests WHERE owner_id = $1 ORDER BY created_at DESC`,
      [ownerId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/owner/payout-requests', requireRoles('owner', 'admin'), async (req, res, next) => {
  try {
    const ownerId = req.user.role === 'owner' ? req.user.id : Number(req.body.owner_id) || req.user.id;
    const amount = Number(req.body.amount);
    if (!(amount > 0)) return res.status(400).json({ error: 'amount must be > 0' });

    const settlementId = req.body.settlement_id || null;
    if (settlementId) {
      const { rows: s } = await query(
        `SELECT * FROM owner_settlements WHERE id = $1 AND owner_id = $2`,
        [settlementId, ownerId]
      );
      if (!s[0]) return res.status(400).json({ error: 'Settlement not found' });
      if (s[0].status === 'disputed' || s[0].status === 'open') {
        return res.status(400).json({ error: 'Cannot request payout against unsettled or disputed funds' });
      }
      if (amount > Number(s[0].net_amount)) {
        return res.status(400).json({ error: 'Amount exceeds settlement net' });
      }
    } else {
      
      const { rows: ready } = await query(
        `SELECT id FROM owner_settlements WHERE owner_id = $1 AND status = 'ready' LIMIT 1`,
        [ownerId]
      );
      if (!ready[0]) {
        return res.status(400).json({ error: 'No ready settlement available for payout' });
      }
    }

    const { rows } = await query(
      `INSERT INTO owner_payout_requests (owner_id, settlement_id, amount, status, two_fa_verified)
       VALUES ($1, $2, $3, 'requested', COALESCE($4, 0))
       RETURNING *`,
      [ownerId, settlementId, amount, req.body.two_fa_verified ? 1 : 0]
    );
    await logAudit({
      userId: req.user.id,
      action: 'REQUEST_OWNER_PAYOUT',
      entityType: 'owner_payout_request',
      entityId: rows[0].id,
      details: { amount, settlement_id: settlementId },
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});


const {
  previewOwnerBlockImpact,
  applyOwnerBlocks,
} = require('../../lib/ownerBlocks');
const { generateOwnerSettlement } = require('../../lib/ownerSettlements');

async function assertOwnerUnitAccess(req, unitId) {
  if (req.user.role === 'admin' || req.user.role === 'owners_relations') return true;
  const { rows } = await query(
    `SELECT 1 FROM owner_units WHERE owner_id = $1 AND unit_id = $2`,
    [req.user.id, unitId]
  );
  return Boolean(rows[0]);
}

router.post('/owner/blocks/preview', requireRoles('owner', 'admin', 'owners_relations'), async (req, res, next) => {
  try {
    const { unit_id, from_date, to_date } = req.body;
    if (!unit_id || !from_date || !to_date) {
      return res.status(400).json({ error: 'unit_id, from_date, to_date required' });
    }
    if (!(await assertOwnerUnitAccess(req, unit_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const impact = await previewOwnerBlockImpact(unit_id, from_date, to_date);
    res.json(impact);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.post('/owner/blocks', requireRoles('owner', 'admin', 'owners_relations'), async (req, res, next) => {
  try {
    const { unit_id, from_date, to_date } = req.body;
    if (!unit_id || !from_date || !to_date) {
      return res.status(400).json({ error: 'unit_id, from_date, to_date required' });
    }
    if (!(await assertOwnerUnitAccess(req, unit_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const impact = await previewOwnerBlockImpact(unit_id, from_date, to_date);
    if (impact.has_conflicts) {
      return res.status(409).json({
        error: 'Selected dates conflict with existing bookings',
        impact,
      });
    }
    const result = await applyOwnerBlocks(unit_id, from_date, to_date);
    await logAudit({
      userId: req.user.id,
      action: 'OWNER_BLOCK_DATES',
      entityType: 'unit',
      entityId: unit_id,
      details: { from_date, to_date, ...result, forgone: impact.estimated_owner_net_forgone },
    });
    res.status(201).json({ ...result, impact });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.delete('/owner/blocks', requireRoles('owner', 'admin', 'owners_relations'), async (req, res, next) => {
  try {
    const unit_id = req.body.unit_id || req.query.unit_id;
    const from_date = req.body.from_date || req.query.from_date;
    const to_date = req.body.to_date || req.query.to_date;
    if (!unit_id || !from_date || !to_date) {
      return res.status(400).json({ error: 'unit_id, from_date, to_date required' });
    }
    if (!(await assertOwnerUnitAccess(req, unit_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await applyOwnerBlocks(unit_id, from_date, to_date, { clear: true });
    await logAudit({
      userId: req.user.id,
      action: 'OWNER_UNBLOCK_DATES',
      entityType: 'unit',
      entityId: unit_id,
      details: { from_date, to_date, ...result },
    });
    res.json(result);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.get('/owner/blocks', requireRoles('owner', 'admin', 'owners_relations'), async (req, res, next) => {
  try {
    const unitId = req.query.unit_id;
    if (!unitId) return res.status(400).json({ error: 'unit_id required' });
    if (!(await assertOwnerUnitAccess(req, unitId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const to =
      req.query.to ||
      new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const { rows: u } = await query(`SELECT wp_post_id FROM units WHERE id = $1`, [unitId]);
    if (!u[0]?.wp_post_id) return res.json([]);
    const { rows } = await query(
      `SELECT date::text AS date, source FROM unit_blocked_dates
       WHERE wp_post_id = $1 AND date >= $2::date AND date < $3::date
       ORDER BY date`,
      [u[0].wp_post_id, from, to]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});


router.get('/owner/settlements', requireRoles('owner', 'admin'), async (req, res, next) => {
  try {
    const ownerId =
      req.user.role === 'owner' ? req.user.id : Number(req.query.owner_id) || req.user.id;
    const { rows } = await query(
      `SELECT * FROM owner_settlements WHERE owner_id = $1 ORDER BY period_end DESC LIMIT 50`,
      [ownerId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/owner/settlements/generate', requireRoles('admin'), async (req, res, next) => {
  try {
    const ownerId = Number(req.body.owner_id);
    const periodStart = req.body.period_start || req.body.from_date;
    const periodEnd = req.body.period_end || req.body.to_date;
    if (!ownerId || !periodStart || !periodEnd) {
      return res.status(400).json({ error: 'owner_id, period_start, period_end required' });
    }
    const row = await generateOwnerSettlement({
      ownerId,
      periodStart,
      periodEnd,
    });
    await logAudit({
      userId: req.user.id,
      action: 'GENERATE_OWNER_SETTLEMENT',
      entityType: 'owner_settlement',
      entityId: row.id,
      details: { owner_id: ownerId, period_start: periodStart, period_end: periodEnd },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.patch('/owner/settlements/:id', requireRoles('admin'), async (req, res, next) => {
  try {
    const status = String(req.body.status || '').toLowerCase();
    if (!['open', 'ready', 'paid', 'disputed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const { rows } = await query(
      `UPDATE owner_settlements SET status = $1, notes = COALESCE($2, notes), updated_at = now()
       WHERE id = $3 RETURNING *`,
      [status, req.body.notes ?? null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_OWNER_SETTLEMENT',
      entityType: 'owner_settlement',
      entityId: rows[0].id,
      details: { status },
    });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/owner/payout-requests/:id/review', requireRoles('admin', 'finance', 'finance_manager'), async (req, res, next) => {
  try {
    const status = String(req.body.status || '').toLowerCase();
    if (!['approved', 'rejected', 'paid'].includes(status)) {
      return res.status(400).json({ error: 'status must be approved, rejected, or paid' });
    }
    const { rows: existing } = await query(
      `SELECT * FROM owner_payout_requests WHERE id = $1`,
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Not found' });
    if (existing[0].status === 'paid') {
      return res.status(400).json({ error: 'Already paid' });
    }

    if (['approved', 'paid'].includes(status) && existing[0].settlement_id) {
      const { rows: s } = await query(`SELECT * FROM owner_settlements WHERE id = $1`, [
        existing[0].settlement_id,
      ]);
      if (!s[0] || !['ready', 'paid'].includes(s[0].status)) {
        return res.status(400).json({ error: 'Settlement must be ready before approving payout' });
      }
      if (s[0].status === 'disputed') {
        return res.status(400).json({ error: 'Cannot pay disputed settlement' });
      }
    }

    const { rows } = await query(
      `UPDATE owner_payout_requests SET
         status = $1,
         rejection_reason = CASE WHEN $1 = 'rejected' THEN $2 ELSE rejection_reason END,
         reviewed_by = $3,
         reviewed_at = now(),
         updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [status, req.body.rejection_reason || null, req.user.id, req.params.id]
    );

    if (status === 'paid' && rows[0].settlement_id) {
      await query(
        `UPDATE owner_settlements SET status = 'paid', updated_at = now() WHERE id = $1`,
        [rows[0].settlement_id]
      );
    }

    await logAudit({
      userId: req.user.id,
      action: 'REVIEW_OWNER_PAYOUT',
      entityType: 'owner_payout_request',
      entityId: rows[0].id,
      details: { status },
    });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});


router.get('/owner/payout-requests/all', requireRoles('admin'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, s.full_name AS owner_name, s.username AS owner_username
       FROM owner_payout_requests p
       JOIN staff_users s ON s.id = p.owner_id
       ORDER BY p.created_at DESC
       LIMIT 100`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

