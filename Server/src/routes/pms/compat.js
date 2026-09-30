const express = require('express');
const { query } = require('../../config/db');
const { authStaff, requireRoles } = require('../../middleware/auth');
const { syncUnitListingStatus } = require('../../lib/unitListingStatus');
const { FINANCIAL_EPOCH, clampFromDate } = require('../../lib/financialEpoch');
const { bookingAssigneeClause, loadReservationAccess, assertReservationOwned, assertBookingAssigned, isAdmin } = require('../../lib/reservationScope');
const { logAudit } = require('../../lib/audit');
const {
  upload,
  attachCloudinaryUrls,
  setCloudinaryFolder,
  FOLDER_PAYMENTS,
} = require('../../config/cloudinary');
const { setOwnerUnits, listLinkableUnits } = require('../../lib/ownerUnits');
const { UNIT_ACQUISITION_ROLES } = require('../../lib/unitAcquisition');

const OWNER_ACCOUNT_ROLES = ['finance', ...UNIT_ACQUISITION_ROLES];
const OWNER_LINK_ROLES = [...UNIT_ACQUISITION_ROLES];


const router = express.Router();
router.use(authStaff);


router.get('/id-documents/view', requireRoles('admin', 'reservations', 'reservations_web', 'reservations_manual', 'reservations_manager', 'finance', 'finance_manager', 'owners_relations', 'operations', 'operations_supervisor'), async (req, res, next) => {
  try {
    const raw = String(req.query.url || '').trim();
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    if (!raw || !cloud) {
      return res.status(400).json({ error: 'Missing document URL' });
    }

    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return res.status(400).json({ error: 'Invalid document URL' });
    }

    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'Invalid document URL' });
    }
    if (!parsed.hostname.endsWith('cloudinary.com')) {
      return res.status(400).json({ error: 'Document must be stored on Cloudinary' });
    }
    if (!raw.includes(`/${cloud}/`)) {
      return res.status(400).json({ error: 'Document is not from this Cloudinary account' });
    }

    // Only proxy URLs that belong to a reservation/booking ID document field.
    const { rows: linked } = await query(
      `SELECT 1 FROM reservations WHERE $1 = ANY(COALESCE(id_photo_urls, '{}'::text[])) LIMIT 1`,
      [raw]
    );
    if (!linked[0]) {
      const { rows: bookingLinked } = await query(
        `SELECT 1 FROM bookings WHERE $1 = ANY(COALESCE(id_photo_urls, '{}'::text[])) LIMIT 1`,
        [raw]
      );
      if (!bookingLinked[0]) {
        return res.status(403).json({ error: 'Document is not linked to a booking or reservation' });
      }
    }

    const upstream = await fetch(raw, { redirect: 'error' });
    if (!upstream.ok) {
      return res.status(502).json({
        error:
          'Could not load this document from Cloudinary. If it is a PDF, enable “Allow delivery of PDF and ZIP files” in Cloudinary Security settings, or re-upload the ID.',
      });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await upstream.arrayBuffer());
    const isPdf = /pdf/i.test(contentType) || /\.pdf($|\?)/i.test(raw);
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${isPdf ? 'id-document.pdf' : 'id-document.jpg'}"`
    );
    res.setHeader('Cache-Control', 'private, max-age=120');
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

router.get('/users/sales', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, full_name, username, role, sales_commission_pct, manager_id FROM staff_users
       WHERE is_active = 1 AND role IN ('reservations_manual','reservations_web','reservations','reservations_manager','admin')`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});


router.get('/users/owners', requireRoles(...OWNER_ACCOUNT_ROLES), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.id, s.full_name, s.email, s.username, s.is_active, s.created_at,
              COUNT(ou.unit_id)::int AS unit_count,
              COALESCE(
                string_agg(
                  COALESCE(NULLIF(u.unit_number, ''), u.title),
                  ', '
                  ORDER BY u.unit_number NULLS LAST, u.title
                ),
                ''
              ) AS unit_numbers
       FROM staff_users s
       LEFT JOIN owner_units ou ON ou.owner_id = s.id
       LEFT JOIN units u ON u.id = ou.unit_id
       WHERE s.role = 'owner'
       GROUP BY s.id, s.full_name, s.email, s.username, s.is_active, s.created_at
       ORDER BY s.full_name`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

/** Rent units that are unlinked, or already linked to owner_id (for editing). */
router.get('/users/owners/linkable-units', requireRoles(...OWNER_LINK_ROLES), async (req, res, next) => {
  try {
    const units = await listLinkableUnits(req.query.owner_id);
    res.json(units);
  } catch (e) {
    next(e);
  }
});

router.get('/users/owners/:id/units', requireRoles(...UNIT_ACQUISITION_ROLES), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.title, u.unit_number, u.project, u.compound, u.area,
              u.status, u.listing_type, u.ops_status,
              COALESCE(u.unit_number, u.title) AS name,
              COALESCE(u.project, u.compound) AS project_label
       FROM owner_units ou
       JOIN units u ON u.id = ou.unit_id
       WHERE ou.owner_id = $1
       ORDER BY u.unit_number NULLS LAST, u.title`,
      [req.params.id]
    );
    res.json(
      rows.map((u) => ({
        ...u,
        id: String(u.id),
        name: u.unit_number || u.name || u.title,
        project: u.project || u.compound || u.project_label,
      }))
    );
  } catch (e) {
    next(e);
  }
});

/** Replace owner ↔ unit portal links (ignores unit owner_name / owner_phone). */
router.put('/users/owners/:id/units', requireRoles(...OWNER_LINK_ROLES), async (req, res, next) => {
  try {
    const units = await setOwnerUnits(req.params.id, req.body?.unit_ids);
    res.json({ ok: true, units, unit_count: units.length });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    next(e);
  }
});

router.get('/payments/all', requireRoles('admin'), async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const to = req.query.to_date || null;
    const method = req.query.payment_method || null;
    const params = [from];
    let where = `COALESCE(payment_date, created_at::date) >= $1::date`;
    if (to) {
      params.push(to);
      where += ` AND COALESCE(payment_date, created_at::date) <= $${params.length}::date`;
    }
    if (method) {
      params.push(method);
      where += ` AND payment_method = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT * FROM payments WHERE ${where} ORDER BY payment_date DESC NULLS LAST, created_at DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get(
  '/commissions/breakdown',
  requireRoles('admin', 'reservations', 'reservations_web'),
  async (req, res, next) => {
  try {
    const from_date = clampFromDate(req.query.from_date);
    const { to_date } = req.query;
    const params = [from_date];
    let where = `r.status <> 'cancelled' AND r.check_in >= $1::date`;
    if (to_date) {
      params.push(to_date);
      where += ` AND r.check_out <= $${params.length}::date`;
    }

    const {
      isAdmin,
      isReservationsTeam,
      reservationScopeClause,
    } = require('../../lib/reservationScope');
    const agentScoped = isReservationsTeam(req.user) && !isAdmin(req.user);
    const scope = agentScoped
      ? reservationScopeClause(req.user, 'r', params.length + 1)
      : { clause: '', params: [] };
    params.push(...scope.params);
    where += scope.clause;

    const { rows } = await query(
      `SELECT
         r.id, r.guest_name, r.check_in, r.check_out, r.nights,
         r.total_amount, r.price_per_night, r.utilities_amount, r.housekeeping_fees,
         r.is_owner_reservation, r.broker_total, r.broker_amount_per_night, r.broker_name,
         r.booking_id, r.booking_source, r.sales_person_id,
         COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
         COALESCE(u.project, u.compound, 'Unassigned') AS project,
         u.commission_mode,
         u.company_commission_pct,
         u.company_commission_owner_pct,
         u.commission_tenant_pct,
         COALESCE(sp.sales_commission_pct, 0) AS agent_commission_pct,
         sp.full_name AS sales_person_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
       WHERE ${where}
       ORDER BY r.check_in DESC`,
      params
    );

    const { calcReservationFinancials, round2 } = require('../../lib/commission');
    const { isWebsiteOriginReservation } = require('../../lib/reservationScope');
    const { agentCommissionFromCompany } = require('../../lib/financeModel');

    let totalGross = 0;
    let totalTenant = 0;
    let totalUtilities = 0;
    let totalHousekeeping = 0;
    let totalCompany = 0;
    let ownerCommission = 0;
    let regularCommission = 0;
    let websiteCount = 0;
    let websiteRevenue = 0;
    let websiteProfit = 0;
    let websiteAgentCommission = 0;
    let manualCount = 0;
    let manualRevenue = 0;
    let manualProfit = 0;
    let manualAgentCommission = 0;

    const breakdown = rows.map((r) => {
      const fin = calcReservationFinancials(r, r);
      totalGross += fin.grossAmount;
      totalTenant += fin.tenantDeduction;
      totalUtilities += fin.utilitiesDeduction;
      totalHousekeeping += fin.housekeepingFees;
      totalCompany += fin.companyCommission;
      if (fin.isOwner) ownerCommission += fin.companyCommission;
      else regularCommission += fin.companyCommission;

      const agent = agentCommissionFromCompany(fin.companyCommission, r.agent_commission_pct);
      const fromWebsite = isWebsiteOriginReservation(r);
      if (fromWebsite) {
        websiteCount += 1;
        websiteRevenue += fin.grossAmount;
        websiteProfit += fin.companyCommission;
        websiteAgentCommission += agent.agentAmount;
      } else {
        manualCount += 1;
        manualRevenue += fin.grossAmount;
        manualProfit += fin.companyCommission;
        manualAgentCommission += agent.agentAmount;
      }

      return {
        id: r.id,
        guest_name: r.guest_name,
        unit_name: r.unit_name,
        project: r.project,
        check_in: r.check_in,
        check_out: r.check_out,
        nights: r.nights,
        is_owner: fin.isOwner,
        from_website: fromWebsite,
        sales_person_id: r.sales_person_id,
        sales_person_name: r.sales_person_name || null,
        agent_commission_pct: agent.agentPct,
        agent_commission: agent.agentAmount,
        gross: fin.grossAmount,
        tenant_deduction: fin.tenantDeduction,
        utilities: fin.utilitiesDeduction,
        housekeeping: fin.housekeepingFees,
        company_commission: fin.companyCommission,
        owner_net: fin.ownerNet,
        applied_pct: fin.appliedCommissionPct,
        mode: fin.mode,
      };
    });

    const channelBlock = (count, revenue, profit, extra = {}) => ({
      reservation_count: count,
      revenue: round2(revenue),
      profit: round2(profit),
      ...extra,
    });

    res.json({
      breakdown,
      scoped_to_agent: agentScoped,
      agent_id: agentScoped ? req.user.id : null,
      totals: {
        totalGross: round2(totalGross),
        totalTenant: round2(totalTenant),
        totalUtilities: round2(totalUtilities),
        totalHousekeeping: round2(totalHousekeeping),
        totalCompany: round2(totalCompany),
        regularCommission: round2(regularCommission),
        ownerRevenue: round2(ownerCommission),
        
        grandTotal: round2(totalCompany + totalTenant),
        manualAgentCommission: round2(manualAgentCommission),
        websiteAgentCommission: round2(websiteAgentCommission),
        agentCommissions: round2(manualAgentCommission + websiteAgentCommission),
        
        myCommission: round2(manualAgentCommission + websiteAgentCommission),
      },
      model: {
        commission_base: 'company_commission',
        agent_pct_source: 'staff_sales_commission_pct',
      },
      channels: {
        all: channelBlock(rows.length, totalGross, totalCompany, {
          agent_commission: round2(manualAgentCommission + websiteAgentCommission),
        }),
        manual: channelBlock(manualCount, manualRevenue, manualProfit, {
          agent_commission: round2(manualAgentCommission),
        }),
        website: channelBlock(websiteCount, websiteRevenue, websiteProfit, {
          agent_commission: round2(websiteAgentCommission),
        }),
      },
      
      website: channelBlock(websiteCount, websiteRevenue, websiteProfit, {
        agent_commission: round2(websiteAgentCommission),
      }),
    });
  } catch (e) {
    next(e);
  }
});


router.get(
  '/commissions/resale-breakdown',
  requireRoles('admin'),
  async (req, res, next) => {
    try {
      const from_date = clampFromDate(req.query.from_date);
      const { to_date } = req.query;
      const agentScoped = req.user.role === 'resale';
      const managerScoped = req.user.role === 'resale_manager';
      const params = [from_date];
      let where = `al.stage = 'signed' AND al.updated_at >= $1::timestamptz`;
      if (to_date) {
        params.push(to_date);
        where += ` AND al.updated_at < ($${params.length}::date + interval '1 day')`;
      }
      if (agentScoped) {
        params.push(req.user.id);
        where += ` AND al.created_by = $${params.length}`;
      } else if (managerScoped) {
        const { rows: team } = await query(
          `SELECT id FROM staff_users
           WHERE is_active = 1 AND (id = $1 OR manager_id = $1) AND role IN ('resale', 'resale_manager')`,
          [req.user.id]
        );
        const teamIds = team.map((row) => row.id);
        if (!teamIds.length) {
          return res.json({ breakdown: [], totals: { sale_value: 0, commission: 0, count: 0 } });
        }
        params.push(teamIds);
        where += ` AND al.created_by = ANY($${params.length}::int[])`;
      }

      const { rows } = await query(
        `SELECT al.id, al.title, al.owner_name, al.project, al.destination,
                al.property_type, al.expected_price, al.stage, al.created_at, al.updated_at,
                al.created_by, su.full_name AS agent_name,
                COALESCE(su.sales_commission_pct, 0) AS agent_commission_pct
         FROM acquisition_leads al
         LEFT JOIN staff_users su ON su.id = al.created_by
         WHERE ${where}
         ORDER BY al.updated_at DESC`,
        params
      );

      const { round2 } = require('../../lib/commission');
      let totalSaleValue = 0;
      let totalCommission = 0;

      const breakdown = rows.map((r) => {
        const saleValue = Number(r.expected_price) || 0;
        const pct = Number(r.agent_commission_pct) || 0;
        const commission = round2((saleValue * pct) / 100);
        totalSaleValue += saleValue;
        totalCommission += commission;
        return {
          id: r.id,
          title: r.title,
          owner_name: r.owner_name,
          project: r.project,
          destination: r.destination,
          property_type: r.property_type,
          sale_value: round2(saleValue),
          agent_commission_pct: pct,
          agent_commission: commission,
          signed_at: r.updated_at,
          created_at: r.created_at,
          agent_name: r.agent_name,
        };
      });

      res.json({
        breakdown,
        scoped_to_agent: agentScoped,
        agent_id: agentScoped ? req.user.id : null,
        totals: {
          signed_deals: rows.length,
          totalSaleValue: round2(totalSaleValue),
          myCommission: round2(totalCommission),
          agentCommissions: round2(totalCommission),
        },
      });
    } catch (e) {
      next(e);
    }
  }
);


router.get('/finance/summary', requireRoles('admin'), async (req, res, next) => {
  try {
    const from_date = clampFromDate(req.query.from_date);
    const to_date = req.query.to_date || null;
    const { calcReservationFinancials, round2 } = require('../../lib/commission');
    const { isWebsiteOriginReservation } = require('../../lib/reservationScope');
    const { TAX_PCT, agentCommissionFromCompany } = require('../../lib/financeModel');

    const resParams = [from_date];
    let resWhere = `r.status <> 'cancelled' AND r.check_in >= $1::date`;
    if (to_date) {
      resParams.push(to_date);
      resWhere += ` AND r.check_out <= $${resParams.length}::date`;
    }

    const { rows: reservations } = await query(
      `SELECT
         r.id, r.nights, r.total_amount, r.price_per_night, r.utilities_amount,
         r.housekeeping_fees, r.is_owner_reservation,
         r.broker_total, r.broker_amount_per_night,
         r.booking_id, r.booking_source, r.sales_person_id,
         u.commission_mode, u.company_commission_pct,
         u.company_commission_owner_pct, u.commission_tenant_pct,
         COALESCE(u.utilities_cost, 0) AS utilities_cost,
         COALESCE(sp.sales_commission_pct, 0) AS agent_commission_pct
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users sp ON sp.id = r.sales_person_id
       WHERE ${resWhere}`,
      resParams
    );

    let reservationRevenue = 0;
    let companyCommission = 0;
    let tenantCommission = 0;
    let ownerOwed = 0;
    let housekeepingStayFees = 0;
    let utilitiesCollected = 0;
    let manualAgentCommission = 0;
    let websiteAgentCommission = 0;
    let websiteCompanyCommission = 0;
    let manualCompanyCommission = 0;

    for (const r of reservations) {
      const utilitiesAmount =
        parseFloat(r.utilities_amount) ||
        (Number(r.nights) || 0) * (parseFloat(r.utilities_cost) || 0);
      const fin = calcReservationFinancials(r, {
        ...r,
        utilities_amount: utilitiesAmount,
      });
      reservationRevenue += fin.grossAmount;
      companyCommission += fin.companyCommission;
      tenantCommission += fin.tenantDeduction;
      ownerOwed += fin.ownerNet;
      housekeepingStayFees += fin.housekeepingFees;
      utilitiesCollected += fin.utilitiesDeduction || utilitiesAmount;

      const fromWebsite = isWebsiteOriginReservation(r);
      const auto = agentCommissionFromCompany(fin.companyCommission, r.agent_commission_pct);
      if (fromWebsite) {
        websiteCompanyCommission += fin.companyCommission;
        websiteAgentCommission += auto.agentAmount;
      } else {
        manualCompanyCommission += fin.companyCommission;
        manualAgentCommission += auto.agentAmount;
      }
    }

    
    const hkParams = [from_date];
    let hkWhere = `status <> 'cancelled' AND period_start >= $1::date`;
    if (to_date) {
      hkParams.push(to_date);
      hkWhere += ` AND period_end <= $${hkParams.length}::date`;
    }
    let housekeepingServiceRevenue = 0;
    try {
      const { rows: hkOrders } = await query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total
         FROM housekeeping_service_orders WHERE ${hkWhere}`,
        hkParams
      );
      housekeepingServiceRevenue = Number(hkOrders[0]?.total) || 0;
    } catch (_) {
      
    }

    
    const expParams = [from_date];
    let expWhere = `expense_date >= $1::date`;
    if (to_date) {
      expParams.push(to_date);
      expWhere += ` AND expense_date <= $${expParams.length}::date`;
    }
    const { rows: expenseRows } = await query(
      `SELECT COALESCE(category, 'other') AS category,
              COALESCE(SUM(amount), 0)::float AS total
       FROM expenses
       WHERE ${expWhere}
         AND COALESCE(paid_by, 'company') <> 'owner'
       GROUP BY COALESCE(category, 'other')`,
      expParams
    );
    let marketing = 0;
    let salaryLedger = 0;
    let actualHousekeeping = 0;
    let actualUtilities = 0;
    let otherExpenses = 0;
    for (const row of expenseRows) {
      const total = Number(row.total) || 0;
      if (row.category === 'marketing') marketing += total;
      else if (row.category === 'salary') salaryLedger += total;
      else if (row.category === 'housekeeping_cost') actualHousekeeping += total;
      else if (row.category === 'utilities_cost') actualUtilities += total;
      else otherExpenses += total;
    }

    const pcParams = [from_date];
    let pcWhere = `entry_type = 'out'
      AND COALESCE(status, 'open') <> 'moved'
      AND COALESCE(paid_by, 'company') <> 'owner'
      AND entry_date >= $1::date`;
    if (to_date) {
      pcParams.push(to_date);
      pcWhere += ` AND entry_date <= $${pcParams.length}::date`;
    }
    const { rows: pettyRows } = await query(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM petty_cash WHERE ${pcWhere}`,
      pcParams
    );
    const pettyCash = Number(pettyRows[0]?.total) || 0;

    // Salaries come only from posted salary expenses (payroll mark-paid).
    // Do not add a live base_salary snapshot — that double-counts once expenses exist.
    const salaries = round2(salaryLedger);

    const agentCommissions = round2(manualAgentCommission + websiteAgentCommission);
    const salaryAndCommissions = round2(salaries + agentCommissions);

    const cfParams = [from_date];
    let cfWhere = `entry_date >= $1::date`;
    if (to_date) {
      cfParams.push(to_date);
      cfWhere += ` AND entry_date <= $${cfParams.length}::date`;
    }
    let cashIn = 0;
    let cashOut = 0;
    try {
      const { rows: cashRows } = await query(
        `SELECT entry_type, COALESCE(SUM(amount), 0)::float AS total
         FROM cash_ledger
         WHERE ${cfWhere}
         GROUP BY entry_type`,
        cfParams
      );
      for (const row of cashRows) {
        if (row.entry_type === 'in') cashIn = Number(row.total) || 0;
        if (row.entry_type === 'out') cashOut = Number(row.total) || 0;
      }
    } catch (_) {
      
    }

    const housekeepingRevenue = round2(housekeepingStayFees + housekeepingServiceRevenue);
    const utilitiesRevenue = round2(utilitiesCollected);
    const totalRevenue = round2(reservationRevenue + housekeepingRevenue + utilitiesRevenue);

    const deductibleExpenses = round2(
      ownerOwed +
        salaryAndCommissions +
        actualHousekeeping +
        actualUtilities +
        pettyCash +
        marketing +
        otherExpenses
    );

    const grossProfit = round2(totalRevenue - deductibleExpenses);
    const taxAmount = round2(Math.max(0, grossProfit) * (TAX_PCT / 100));
    const netProfit = round2(grossProfit - taxAmount);
    const commissionProfit = round2(companyCommission - agentCommissions);

    res.json({
      from_date,
      to_date: to_date || null,
      financial_epoch: FINANCIAL_EPOCH,
      model: {
        tax_pct: TAX_PCT,
        commission_base: 'company_commission',
        agent_pct_source: 'staff_sales_commission_pct',
      },
      
      totalRevenue,
      reservationRevenue: round2(reservationRevenue),
      housekeepingRevenue,
      housekeepingStayFees: round2(housekeepingStayFees),
      housekeepingServiceRevenue: round2(housekeepingServiceRevenue),
      utilitiesRevenue,
      
      companyCommission: round2(companyCommission),
      tenantCommission: round2(tenantCommission),
      ownerOwed: round2(ownerOwed),
      websiteCompanyCommission: round2(websiteCompanyCommission),
      manualCompanyCommission: round2(manualCompanyCommission),
      
      agentCommissions,
      manualAgentCommission: round2(manualAgentCommission),
      websiteAgentCommission: round2(websiteAgentCommission),
      websiteMakerCommission: 0,
      salaryAndCommissions,
      
      salaries,
      housekeeping: round2(actualHousekeeping),
      housekeepingCost: round2(actualHousekeeping),
      actualHousekeeping: round2(actualHousekeeping),
      utilities: round2(actualUtilities),
      actualUtilities: round2(actualUtilities),
      pettyCash: round2(pettyCash),
      marketing: round2(marketing),
      expenses: round2(otherExpenses),
      otherExpenses: round2(otherExpenses),
      cashflow: {
        inflow: round2(cashIn),
        outflow: round2(cashOut),
        net: round2(cashIn - cashOut),
      },
      totalExpenses: deductibleExpenses,
      
      grossProfit,
      taxPct: TAX_PCT,
      taxAmount,
      commissionProfit,
      netProfit,
      profit: netProfit,
      expenseBreakdown: {
        ownerShare: round2(ownerOwed),
        salaries,
        manualAgentCommission: round2(manualAgentCommission),
        websiteAgentCommission: round2(websiteAgentCommission),
        websiteMakerCommission: 0,
        agentCommissions,
        salaryAndCommissions,
        actualHousekeeping: round2(actualHousekeeping),
        housekeeping: round2(actualHousekeeping),
        actualUtilities: round2(actualUtilities),
        utilities: round2(actualUtilities),
        pettyCash: round2(pettyCash),
        marketing: round2(marketing),
        expenses: round2(otherExpenses),
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/daily-prices', async (req, res, next) => {
  try {
    const { from_date, to_date } = req.query;
    const { rows } = await query(
      `SELECT udp.wp_post_id, u.id AS unit_id, udp.date::text AS date, udp.price
       FROM unit_daily_prices udp
       JOIN units u ON u.wp_post_id = udp.wp_post_id
       WHERE ($1::date IS NULL OR udp.date >= $1)
         AND ($2::date IS NULL OR udp.date <= $2)
       ORDER BY udp.date`,
      [from_date || null, to_date || null]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

function localIsoFromParts(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function eachDateInclusive(fromStr, toStr) {
  const [fy, fm, fd] = String(fromStr).split('-').map(Number);
  const [ty, tm, td] = String(toStr).split('-').map(Number);
  const out = [];
  const cur = new Date(fy, fm - 1, fd);
  const end = new Date(ty, tm - 1, td);
  while (cur <= end) {
    out.push(localIsoFromParts(cur.getFullYear(), cur.getMonth() + 1, cur.getDate()));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

router.post('/daily-prices/batch', requireRoles('admin'), async (req, res, next) => {
  try {
    const { unit_id, from_date, to_date, price, clear } = req.body;
    const { rows: u } = await query(`SELECT wp_post_id FROM units WHERE id = $1`, [unit_id]);
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    const dates = eachDateInclusive(from_date, to_date);
    let n = 0;
    if (clear || price === null || price === '' || Number(price) <= 0) {
      for (const dateStr of dates) {
        await query(`DELETE FROM unit_daily_prices WHERE wp_post_id = $1 AND date = $2`, [
          u[0].wp_post_id,
          dateStr,
        ]);
        n++;
      }
      
      await syncUnitListingStatus(unit_id);
      return res.json({ ok: true, cleared: n });
    }
    for (const dateStr of dates) {
      await query(
        `INSERT INTO unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
         VALUES ($1,$2,$3,'EGP','manual-admin',now())
         ON CONFLICT (wp_post_id, date) DO UPDATE SET
           price = EXCLUDED.price, source = EXCLUDED.source, updated_at = now()`,
        [u[0].wp_post_id, dateStr, price]
      );
      n++;
    }
    await syncUnitListingStatus(unit_id);
    res.json({ ok: true, count: n });
  } catch (e) {
    next(e);
  }
});

const RESERVATIONS_CALENDAR_ROLES = ['admin', 'reservations', 'reservations_web', 'reservations_manual', 'reservations_manager'];

router.get('/ota-calendar', async (_req, res, next) => {
  try {
    const { calendarExportUrl, OTA_PLATFORM_LABELS } = require('../../lib/otaPlatforms');
    const { rows: units } = await query(
      `SELECT id, wp_post_id, slug, title, unit_number, status
       FROM units
       WHERE status = 'published'
       ORDER BY title NULLS LAST, unit_number NULLS LAST`
    );
    const { rows: feeds } = await query(
      `SELECT id, unit_id, wp_post_id, platform, label, ical_url, enabled,
              external_listing_id, sync_status, last_sync_at, last_sync_error, updated_at
       FROM unit_ota_feeds
       ORDER BY platform`
    );
    const feedsByUnit = new Map();
    for (const feed of feeds) {
      if (!feedsByUnit.has(feed.unit_id)) feedsByUnit.set(feed.unit_id, []);
      const status =
        !feed.enabled
          ? 'disconnected'
          : feed.sync_status === 'syncing'
            ? 'syncing'
            : feed.last_sync_error
              ? 'failed'
              : feed.last_sync_at
                ? 'connected'
                : feed.sync_status || 'disconnected';
      feedsByUnit.get(feed.unit_id).push({
        ...feed,
        connection_type: 'ical',
        status,
        provider_label: `${OTA_PLATFORM_LABELS[feed.platform] || feed.platform} (iCal)`,
      });
    }
    res.json(
      units.map((unit) => ({
        ...unit,
        export_url: unit.slug ? calendarExportUrl(unit.slug) : null,
        feeds: feedsByUnit.get(unit.id) || [],
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.put('/ota-calendar/:unitId/:platform', requireRoles(...RESERVATIONS_CALENDAR_ROLES), async (req, res, next) => {
  try {
    const {
      normalizeOtaPlatform,
      assertValidIcalUrl,
    } = require('../../lib/otaPlatforms');
    const { runChannelSync } = require('../../lib/channelManager');
    const platform = normalizeOtaPlatform(req.params.platform);
    if (!platform) return res.status(400).json({ error: 'Invalid platform' });

    const { rows: u } = await query(
      `SELECT id, wp_post_id, slug, title FROM units WHERE id = $1`,
      [req.params.unitId]
    );
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });

    const { ical_url, label, enabled, external_listing_id } = req.body || {};
    if (ical_url === null || ical_url === '') {
      await query(`DELETE FROM unit_ota_feeds WHERE unit_id = $1 AND platform = $2`, [
        u[0].id,
        platform,
      ]);
      return res.json({ ok: true, cleared: true, platform });
    }

    const url = assertValidIcalUrl(ical_url);

    const { rows } = await query(
      `INSERT INTO unit_ota_feeds
         (unit_id, wp_post_id, platform, label, ical_url, enabled, external_listing_id, sync_status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'disconnected',now())
       ON CONFLICT (unit_id, platform) DO UPDATE SET
         ical_url = EXCLUDED.ical_url,
         label = EXCLUDED.label,
         enabled = EXCLUDED.enabled,
         external_listing_id = COALESCE(EXCLUDED.external_listing_id, unit_ota_feeds.external_listing_id),
         updated_at = now()
       RETURNING *`,
      [
        u[0].id,
        u[0].wp_post_id,
        platform,
        label || null,
        url,
        enabled !== false,
        external_listing_id || null,
      ]
    );

    await query(
      `INSERT INTO listing_ical (wordpress_post_id, listing_slug, ical_url, notes, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (wordpress_post_id) DO UPDATE SET
         ical_url = EXCLUDED.ical_url,
         listing_slug = EXCLUDED.listing_slug,
         notes = EXCLUDED.notes,
         updated_at = now()`,
      [u[0].wp_post_id, u[0].slug, url, label || null]
    );
    await query(`UPDATE units SET ical_url = $1, updated_at = now() WHERE id = $2`, [url, u[0].id]);

    const sync = await runChannelSync({ feedId: rows[0].id });
    res.json({ feed: rows[0], sync });
  } catch (e) {
    if (e.message?.includes('calendar URL')) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.delete('/ota-calendar/:unitId/:platform', requireRoles(...RESERVATIONS_CALENDAR_ROLES), async (req, res, next) => {
  try {
    const { normalizeOtaPlatform } = require('../../lib/otaPlatforms');
    const platform = normalizeOtaPlatform(req.params.platform);
    if (!platform) return res.status(400).json({ error: 'Invalid platform' });

    const { rows } = await query(
      `DELETE FROM unit_ota_feeds
       WHERE unit_id = $1 AND platform = $2
       RETURNING id`,
      [req.params.unitId, platform]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Feed not found' });
    res.json({ ok: true, platform });
  } catch (e) {
    next(e);
  }
});

router.post('/ota-calendar/refresh', requireRoles(...RESERVATIONS_CALENDAR_ROLES), async (req, res, next) => {
  try {
    const { runChannelSync } = require('../../lib/channelManager');
    const unitId = req.body?.unit_id || null;
    const feedId = req.body?.feed_id || null;
    const result = await runChannelSync({ unitId, feedId });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/listing-ical', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.unit_id, f.wp_post_id AS wordpress_post_id, u.slug AS listing_slug,
              f.ical_url, f.label AS notes, f.platform, f.updated_at,
              u.title AS unit_title, u.unit_number
       FROM unit_ota_feeds f
       JOIN units u ON u.id = f.unit_id
       ORDER BY u.title NULLS LAST, f.platform`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.put('/listing-ical/:unitId', requireRoles(...RESERVATIONS_CALENDAR_ROLES), async (req, res, next) => {
  try {
    const { assertValidIcalUrl } = require('../../lib/otaPlatforms');
    const { runChannelSync } = require('../../lib/channelManager');
    const { ical_url, notes } = req.body || {};
    const { rows: u } = await query(`SELECT id, wp_post_id, slug, title FROM units WHERE id = $1`, [
      req.params.unitId,
    ]);
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });
    if (!ical_url) {
      await query(`DELETE FROM unit_ota_feeds WHERE unit_id = $1 AND platform = 'other'`, [u[0].id]);
      await query(`DELETE FROM listing_ical WHERE wordpress_post_id = $1`, [u[0].wp_post_id]);
      return res.json({ ok: true, cleared: true });
    }
    const url = assertValidIcalUrl(ical_url);
    const { rows } = await query(
      `INSERT INTO unit_ota_feeds
         (unit_id, wp_post_id, platform, label, ical_url, enabled, updated_at)
       VALUES ($1,$2,'other',$3,$4,true,now())
       ON CONFLICT (unit_id, platform) DO UPDATE SET
         ical_url = EXCLUDED.ical_url,
         label = EXCLUDED.label,
         updated_at = now()
       RETURNING *`,
      [u[0].id, u[0].wp_post_id, notes || null, url]
    );
    await query(
      `INSERT INTO listing_ical (wordpress_post_id, listing_slug, ical_url, notes, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (wordpress_post_id) DO UPDATE SET
         ical_url = EXCLUDED.ical_url,
         listing_slug = EXCLUDED.listing_slug,
         notes = EXCLUDED.notes,
         updated_at = now()`,
      [u[0].wp_post_id, u[0].slug, url, notes || null]
    );
    await query(`UPDATE units SET ical_url = $1, updated_at = now() WHERE id = $2`, [url, u[0].id]);
    const sync = await runChannelSync({ feedId: rows[0].id });
    res.json({ ...rows[0], sync });
  } catch (e) {
    if (e.message?.includes('calendar URL')) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.post('/listing-ical/refresh', requireRoles(...RESERVATIONS_CALENDAR_ROLES), async (req, res, next) => {
  try {
    const { runChannelSync } = require('../../lib/channelManager');
    const result = await runChannelSync();
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/calendar-blocks', async (req, res, next) => {
  try {
    const { fetchCalendarOccupancyRows } = require('../../lib/calendarOccupancy');
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const to = req.query.to || new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
    const unitId = req.query.unit_id;
    let wpPostId = null;
    if (unitId) {
      const { rows: u } = await query(`SELECT wp_post_id FROM units WHERE id = $1`, [unitId]);
      if (!u[0]?.wp_post_id) return res.json([]);
      wpPostId = u[0].wp_post_id;
    }
    const rows = await fetchCalendarOccupancyRows({ from, to, wpPostId });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.put('/blocked-dates/:unitId', requireRoles('admin'), async (req, res, next) => {
  try {
    const { eachDate, ensureWpPostId } = require('../../lib/ownerBlocks');
    const { dates = [], clear = false, from_date, to_date } = req.body;
    const wp = await ensureWpPostId(req.params.unitId);
    if (wp == null) return res.status(404).json({ error: 'Unit not found' });

    let nights = Array.isArray(dates) ? dates.filter(Boolean).map((d) => String(d).slice(0, 10)) : [];
    if (!nights.length && from_date && to_date) {
      
      const endExclusive = new Date(`${String(to_date).slice(0, 10)}T00:00:00`);
      endExclusive.setDate(endExclusive.getDate() + 1);
      const y = endExclusive.getFullYear();
      const m = String(endExclusive.getMonth() + 1).padStart(2, '0');
      const day = String(endExclusive.getDate()).padStart(2, '0');
      nights = eachDate(String(from_date).slice(0, 10), `${y}-${m}-${day}`);
    }

    if (!nights.length) {
      return res.status(400).json({ error: 'Provide dates[] or from_date and to_date' });
    }

    const rangeFrom = nights[0];
    const rangeTo = nights[nights.length - 1];

    if (clear) {
      
      
      
      const deletedBlocks = await query(
        `DELETE FROM unit_blocked_dates
         WHERE wp_post_id = $1
           AND date >= $2::date
           AND date <= $3::date
         RETURNING date::text AS date, COALESCE(source, 'manual') AS source`,
        [wp, rangeFrom, rangeTo]
      );
      const deletedIcal = await query(
        `DELETE FROM unit_ical_blocks
         WHERE wp_post_id = $1
           AND date >= $2::date
           AND date <= $3::date
         RETURNING date::text AS date`,
        [wp, rangeFrom, rangeTo]
      );

      const { rows: stillReserved } = await query(
        `SELECT DISTINCT d::text AS date
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         , generate_series(r.check_in, r.check_out - 1, interval '1 day') d
         WHERE u.wp_post_id = $1
           AND r.status <> 'cancelled'
           AND d >= $2::date AND d <= $3::date
         ORDER BY 1`,
        [wp, rangeFrom, rangeTo]
      );

      const cleared = deletedBlocks.rowCount + deletedIcal.rowCount;
      return res.json({
        ok: true,
        cleared,
        cleared_blocks: deletedBlocks.rowCount,
        cleared_ical: deletedIcal.rowCount,
        still_reserved: stillReserved.map((r) => r.date),
        from_date: rangeFrom,
        to_date: rangeTo,
      });
    }

    let n = 0;
    for (const date of nights) {
      await query(
        `INSERT INTO unit_blocked_dates (wp_post_id, date, source, updated_at)
         VALUES ($1,$2,'manual',now())
         ON CONFLICT (wp_post_id, date) DO UPDATE SET source = 'manual', updated_at = now()`,
        [wp, date]
      );
      n += 1;
    }
    res.json({ ok: true, count: n, from_date: rangeFrom, to_date: rangeTo });
  } catch (e) {
    next(e);
  }
});


function tryParseBookingMetaChunk(chunk) {
  const text = String(chunk || '').trim();
  if (!text) return null;
  try {
    const meta = JSON.parse(text);
    if (meta && typeof meta === 'object') return meta;
  } catch {}
  // Accept lines like: [commission] {"accepted_at":...}
  const brace = text.indexOf('{');
  if (brace >= 0) {
    try {
      const meta = JSON.parse(text.slice(brace));
      if (meta && typeof meta === 'object') return meta;
    } catch {}
  }
  return null;
}

function parseBookingDecisionMeta(notes) {
  const text = String(notes || '');
  let accepted = null;
  let rejected = null;
  const chunks = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const candidates = [...chunks].reverse();
  if (text.trim().startsWith('{')) candidates.push(text.trim());

  for (const chunk of candidates) {
    const meta = tryParseBookingMetaChunk(chunk);
    if (!meta) continue;
    if (meta.reject_reason || meta.rejected_by || meta.rejected_by_name) {
      if (!rejected) rejected = meta;
    }
    if (meta.accepted_by || meta.accepted_by_name || meta.accepted_at) {
      if (!accepted) accepted = meta;
    }
  }
  return { accepted, rejected };
}

function mapWebsiteBookingDecision(row) {
  const { accepted, rejected } = parseBookingDecisionMeta(row.notes);
  const status = String(row.status || '').toLowerCase();
  const total = Number(row.total_egp) || 0;
  const amountPaid = Number(row.amount_paid) || 0;
  const method = String(row.payment_method || '').toLowerCase();
  const paymentStatus = String(
    row.reservation_payment_status || row.payment_status || ''
  ).toLowerCase();
  const prepaid = method.includes('paymob') || method.includes('card');
  const amountDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const fullyPaid =
    prepaid || paymentStatus === 'paid' || (total > 0 && amountDue <= 0.009);
  const requestedAt = row.created_at || null;

  if (status === 'cancelled' && (rejected || row.cancellation_reason)) {
    const isReject = !!(rejected?.reject_reason || rejected?.rejected_by || rejected?.rejected_by_name);
    return {
      decision: isReject ? 'rejected' : 'cancelled',
      decision_label: isReject ? 'Rejected' : 'Cancelled',
      decision_reason:
        rejected?.reject_reason ||
        row.cancellation_reason ||
        null,
      decided_by_name: rejected?.rejected_by_name || null,
      requested_at: requestedAt,
      decided_at: rejected?.rejected_at || null,
      amount_paid: amountPaid,
      amount_due: amountDue,
    };
  }

  if (status === 'confirmed') {
    if (fullyPaid) {
      return {
        decision: 'accepted',
        decision_label: 'Accepted',
        decision_reason: null,
        decided_by_name: accepted?.accepted_by_name || row.assigned_agent_name || null,
        requested_at: requestedAt,
        decided_at: accepted?.accepted_at || null,
        amount_paid: prepaid ? total : amountPaid,
        amount_due: 0,
      };
    }
    return {
      decision: 'pending',
      decision_label: 'Pending',
      decision_reason: null,
      decided_by_name: accepted?.accepted_by_name || row.assigned_agent_name || null,
      requested_at: requestedAt,
      decided_at: accepted?.accepted_at || null,
      amount_paid: amountPaid,
      amount_due: amountDue,
    };
  }

  return {
    decision: status || 'unknown',
    decision_label: status || 'Unknown',
    decision_reason: row.cancellation_reason || null,
    decided_by_name: null,
    requested_at: requestedAt,
    decided_at: null,
    amount_paid: amountPaid,
    amount_due: amountDue,
  };
}

router.get('/website-bookings', async (req, res, next) => {
  try {
    const status = req.query.status;
    const params = [];
    let where = 'TRUE';
    const statusKey = String(status || '').toLowerCase();
    const historyMode = statusKey === 'history';

    if (historyMode) {
      where = `b.status IN ('confirmed', 'cancelled')`;
    } else if (statusKey === 'pending') {
      where = `b.status IN ('pending', 'held')`;
    } else if (status) {
      params.push(status);
      where = `b.status = $${params.length}`;
    }

    // Open requests are shared by the whole website team; history stays scoped to who handled it.
    const scope = historyMode
      ? bookingAssigneeClause(req.user, 'b', params.length + 1)
      : { clause: '', params: [], nextIndex: params.length + 1 };
    params.push(...scope.params);
    const limit = historyMode ? 300 : 200;
    const { rows } = await query(
      `SELECT b.*,
              u.title AS unit_title,
              u.unit_number,
              u.slug AS unit_slug,
              su.full_name AS assigned_agent_name,
              r.id AS reservation_id,
              COALESCE(r.amount_paid, 0)::float AS amount_paid,
              COALESCE(NULLIF(r.payment_status, ''), b.payment_status) AS reservation_payment_status,
              promo.code AS promo_code,
              promo.discount_amount AS promo_discount_amount,
              promo.discount_percent AS promo_discount_percent,
              COALESCE(
                NULLIF(b.id_photo_urls, '{}'),
                (
                  SELECT ARRAY(
                    SELECT jsonb_array_elements_text(ccs.payload->'photo_urls')
                  )
                  FROM card_checkout_sessions ccs
                  WHERE ccs.booking_id = b.id
                    AND jsonb_typeof(ccs.payload->'photo_urls') = 'array'
                  LIMIT 1
                ),
                (
                  SELECT ARRAY(
                    SELECT jsonb_array_elements_text(ccs.payload->'photo_urls')
                  )
                  FROM card_checkout_sessions ccs
                  WHERE ccs.status = 'pending'
                    AND ccs.payload->>'guest_email' = b.guest_email
                    AND ccs.payload->>'checkin' = b.checkin::text
                    AND ccs.payload->>'checkout' = b.checkout::text
                    AND jsonb_typeof(ccs.payload->'photo_urls') = 'array'
                  ORDER BY ccs.created_at DESC
                  LIMIT 1
                ),
                '{}'::text[]
              ) AS id_photo_urls
       FROM bookings b
       LEFT JOIN units u ON u.id = b.unit_id
       LEFT JOIN staff_users su ON su.id = b.assigned_sales_id
       LEFT JOIN LATERAL (
         SELECT id, amount_paid, payment_status
         FROM reservations
         WHERE booking_id = b.id
         ORDER BY created_at DESC
         LIMIT 1
       ) r ON TRUE
       LEFT JOIN LATERAL (
         SELECT p.code,
                red.discount_amount,
                p.discount_percent
         FROM promo_code_redemptions red
         JOIN promo_codes p ON p.id = red.promo_code_id
         WHERE red.booking_id = b.id
         ORDER BY red.created_at DESC
         LIMIT 1
       ) promo ON TRUE
       WHERE ${where}${scope.clause}
       ORDER BY b.created_at DESC
       LIMIT ${limit}`,
      params
    );

    if (historyMode) {
      const history = rows
        .map((row) => {
          const decision = mapWebsiteBookingDecision(row);
          
          if (
            decision.decision !== 'accepted' &&
            decision.decision !== 'pending' &&
            decision.decision !== 'rejected'
          ) {
            return null;
          }
          return {
            ...row,
            ...decision,
            amount_paid: decision.amount_paid ?? (Number(row.amount_paid) || 0),
            amount_due:
              decision.amount_due ??
              Math.max(
                0,
                Math.round(((Number(row.total_egp) || 0) - (Number(row.amount_paid) || 0)) * 100) / 100
              ),
          };
        })
        .filter(Boolean);
      return res.json(history);
    }

    const unitIds = [...new Set(rows.map((r) => r.unit_id).filter(Boolean))];
    const unitById = new Map();
    if (unitIds.length) {
      const { rows: units } = await query(
        `SELECT * FROM units WHERE id = ANY($1::uuid[])`,
        [unitIds]
      );
      for (const u of units) unitById.set(u.id, u);
    }

    const { quoteStay, toIsoDate } = require('../../services/pricing');
    const enriched = [];
    for (const row of rows) {
      const total = Number(row.total_egp) || 0;
      const prepaid =
        String(row.payment_status || '').toLowerCase() === 'paid' ||
        /paymob|card/i.test(String(row.payment_method || ''));
      const amountPaid = prepaid ? total : Number(row.amount_paid) || 0;

      let breakdown = {
        nights: null,
        subtotal: null,
        housekeeping_fees: null,
        beach_access_fees: null,
        service_fees: null,
        security_deposit: null,
        fee_lines: [],
        amount_before_promo: null,
        promo_code: row.promo_code || null,
        promo_discount: Number(row.promo_discount_amount) > 0 ? Number(row.promo_discount_amount) : null,
        promo_discount_percent:
          row.promo_discount_percent != null ? Number(row.promo_discount_percent) : null,
        total_egp: total,
        amount_paid: amountPaid,
        amount_due: Math.max(0, Math.round((total - amountPaid) * 100) / 100),
        payment_status: row.payment_status || (prepaid ? 'paid' : 'pending'),
      };

      const unit = unitById.get(row.unit_id);
      const wp = unit?.wp_post_id || row.listing_wp_id;
      const checkinIso = toIsoDate(row.checkin);
      const checkoutIso = toIsoDate(row.checkout);
      if (unit && wp && checkinIso && checkoutIso) {
        try {
          const quote = await quoteStay({
            wpPostId: wp,
            checkin: checkinIso,
            checkout: checkoutIso,
            unit,
            adults: Number(row.adults) > 0 ? Number(row.adults) : Number(row.guests) || 1,
            teens: Number(row.children) || 0,
            skipBlockCheck: true,
          });
          if (quote?.available && Number(quote.nights) > 0 && Number(quote.subtotal) > 0) {
            const quoteTotal = Number(quote.total_egp) || 0;
            const lineSum =
              Number(quote.subtotal || 0) +
              Number(quote.cleaning_fee_egp || 0) +
              Number(quote.access_fee_egp || 0) +
              Number(quote.service_fee_egp || 0);
            // Guest checkout total (includes promo) is authoritative — never replace with a fresh undiscounted quote.
            const displayTotal = total > 0 ? total : quoteTotal;
            const hasPromo = Boolean(row.promo_code) || Number(row.promo_discount_amount) > 0;
            let promoDiscount = 0;
            if (hasPromo && displayTotal > 0 && lineSum > displayTotal + 0.5) {
              promoDiscount = Math.round((lineSum - displayTotal) * 100) / 100;
            } else if (Number(row.promo_discount_amount) > 0) {
              promoDiscount = Number(row.promo_discount_amount);
            } else if (quoteTotal > displayTotal + 0.5) {
              promoDiscount = Math.round((quoteTotal - displayTotal) * 100) / 100;
            }
            const paid = prepaid ? displayTotal : amountPaid;
            breakdown = {
              nights: quote.nights,
              subtotal: quote.subtotal,
              housekeeping_fees: quote.cleaning_fee_egp,
              beach_access_fees: quote.access_fee_egp,
              service_fees: quote.service_fee_egp,
              service_fee_percent: quote.service_fee_percent,
              security_deposit: quote.security_deposit_egp,
              fee_lines: quote.lines || [],
              amount_before_promo:
                promoDiscount > 0 ? lineSum || quoteTotal : hasPromo ? lineSum || null : null,
              promo_code: row.promo_code || null,
              promo_discount: promoDiscount > 0 ? promoDiscount : null,
              promo_discount_percent:
                row.promo_discount_percent != null ? Number(row.promo_discount_percent) : null,
              total_egp: displayTotal,
              amount_paid: paid,
              amount_due: Math.max(0, Math.round((displayTotal - paid) * 100) / 100),
              payment_status: row.payment_status || (prepaid ? 'paid' : 'pending'),
            };
          }
        } catch (_) {}
      }

      enriched.push({
        ...row,
        amount_paid: breakdown.amount_paid,
        amount_due: breakdown.amount_due,
        payment_breakdown: breakdown,
      });
    }

    res.json(enriched);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/website-bookings/:id/accept',
  requireRoles('reservations_web', 'reservations', 'admin'),
  upload.single('evidence'),
  setCloudinaryFolder(FOLDER_PAYMENTS),
  attachCloudinaryUrls,
  async (req, res, next) => {
    try {
      const { acceptWebsiteBooking } = require('../../services/bookingWorkflow');
      const body = req.body || {};
      const booking = await acceptWebsiteBooking(req.params.id, req.user, {
        paymentMode: body.payment_mode || body.paymentMode || null,
        amountPaid: body.amount_paid ?? body.amountPaid,
        evidenceUrl: req.file?.path || req.file?.secure_url || body.evidence_url || null,
        evidenceName: req.file?.originalname || body.evidence_name || null,
      });
      try {
        const { notifyWebsiteBookingAccepted } = require('../../services/pmsNotifications');
        await notifyWebsiteBookingAccepted(booking, req.user);
      } catch (_) {}
      await logAudit({
        userId: req.user.id,
        action: 'ACCEPT_WEBSITE_BOOKING',
        entityType: 'booking',
        entityId: booking.id,
        details: {
          guest_name: booking.guest_name || null,
          unit_id: booking.unit_id || null,
          checkin: booking.checkin || null,
          checkout: booking.checkout || null,
          reservation_id: booking.reservation_id || null,
        },
      });
      res.json(booking);
    } catch (e) {
      next(e);
    }
  }
);

router.post('/website-bookings/:id/reject', requireRoles('reservations_web', 'reservations', 'admin'), async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {
      return res.status(400).json({ error: 'A rejection reason is required' });
    }
    const { rejectWebsiteBooking } = require('../../services/bookingWorkflow');
    const booking = await rejectWebsiteBooking(req.params.id, req.user, reason);
    try {
      const { notifyWebsiteBookingRejected } = require('../../services/pmsNotifications');
      await notifyWebsiteBookingRejected(booking, req.user, reason);
    } catch (_) {}
    await logAudit({
      userId: req.user.id,
      action: 'REJECT_WEBSITE_BOOKING',
      entityType: 'booking',
      entityId: booking.id,
      details: {
        guest_name: booking.guest_name || null,
        unit_id: booking.unit_id || null,
        reason,
      },
    });
    res.json(booking);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/website-bookings/:id/collected-amount',
  requireRoles('reservations_web', 'reservations', 'admin'),
  async (req, res, next) => {
    try {
      const body = req.body || {};
      const { updateWebsiteBookingCollectedAmount } = require('../../services/bookingWorkflow');
      const booking = await updateWebsiteBookingCollectedAmount(req.params.id, req.user, {
        amountPaid: body.amount_paid ?? body.amountPaid,
        paymentMethod: body.payment_method ?? body.paymentMethod ?? null,
      });
      await logAudit({
        userId: req.user.id,
        action: 'UPDATE_WEBSITE_COLLECTED',
        entityType: 'booking',
        entityId: booking.id,
        details: {
          guest_name: booking.guest_name || null,
          amount_paid: booking.amount_paid ?? body.amount_paid ?? body.amountPaid ?? null,
          payment_method: body.payment_method ?? body.paymentMethod ?? null,
        },
      });
      res.json(booking);
    } catch (e) {
      next(e);
    }
  }
);

router.get('/owner-units/my-units', requireRoles('admin'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.* FROM owner_units ou JOIN units u ON u.id = ou.unit_id WHERE ou.owner_id = $1`,
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.put('/notifications/read-all', async (req, res, next) => {
  try {
    await query(`UPDATE notifications SET is_read = 1 WHERE user_id = $1`, [req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.put('/notifications/:id/read', async (req, res, next) => {
  try {
    await query(`UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      req.user.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/petty-cash/settings', requireRoles('admin'), async (req, res, next) => {
  try {
    const location = req.query.location || 'main';
    const { rows } = await query(`SELECT * FROM petty_cash_settings WHERE location = $1`, [location]);
    res.json(rows[0] || { location, opening_balance: 0 });
  } catch (e) {
    next(e);
  }
});

router.put('/petty-cash/settings', requireRoles('admin'), async (req, res, next) => {
  try {
    const { location = 'main', opening_balance } = req.body;
    const { rows } = await query(
      `INSERT INTO petty_cash_settings (location, opening_balance, updated_at)
       VALUES ($1,$2,now())
       ON CONFLICT (location) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, updated_at = now()
       RETURNING *`,
      [location, opening_balance]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.get('/treasury', requireRoles('admin'), async (req, res, next) => {
  try {
    const from = clampFromDate(req.query.from_date);
    const to = req.query.to_date || null;
    const params = [from];
    let where = `entry_date >= $1::date`;
    if (to) {
      params.push(to);
      where += ` AND entry_date <= $${params.length}::date`;
    }
    const { rows } = await query(
      `SELECT * FROM cash_ledger WHERE ${where} ORDER BY entry_date DESC LIMIT 200`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get('/utilities', async (req, res, next) => {
  try {
    const from_date = clampFromDate(req.query.from_date);
    const { to_date, project, unit_id } = req.query;
    const params = [from_date];
    const conditions = [`r.status <> 'cancelled'`, `r.check_in >= $1::date`];

    if (to_date) {
      params.push(to_date);
      conditions.push(`r.check_out <= $${params.length}::date`);
    }
    if (project) {
      params.push(project);
      conditions.push(`(u.project = $${params.length} OR u.compound = $${params.length})`);
    }
    if (unit_id) {
      params.push(unit_id);
      conditions.push(`r.unit_id = $${params.length}`);
    }

    const { rows } = await query(
      `SELECT
         r.id,
         u.id AS unit_id,
         COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
         COALESCE(u.project, u.compound) AS project,
         COALESCE(u.utilities_cost, 0) AS utilities_cost,
         r.guest_name,
         r.check_in,
         r.check_out,
         r.nights,
         r.total_amount,
         COALESCE(
           NULLIF(r.utilities_amount, 0),
           (r.nights * COALESCE(u.utilities_cost, 0))
         )::real AS total_utilities_deducted
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.check_in DESC`,
      params
    );

    const data = rows.filter((r) => Number(r.total_utilities_deducted) > 0);
    const totalUtilities = data.reduce(
      (s, r) => s + (Number(r.total_utilities_deducted) || 0),
      0
    );

    res.json({
      data,
      summary: {
        total_utilities_deducted: totalUtilities,
        total_reservations: data.length,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/housekeeping', async (req, res, next) => {
  try {
    const from_date = clampFromDate(req.query.from_date);
    const { to_date, unit_id, project } = req.query;
    const params = [from_date];
    const conditions = [
      `r.status <> 'cancelled'`,
      `COALESCE(r.housekeeping_fees, 0) > 0`,
      `r.check_in >= $1::date`,
    ];

    if (to_date) {
      params.push(to_date);
      conditions.push(`r.check_in <= $${params.length}::date`);
    }
    if (unit_id) {
      params.push(unit_id);
      conditions.push(`r.unit_id = $${params.length}`);
    }
    if (project) {
      params.push(project);
      conditions.push(`(u.project = $${params.length} OR u.compound = $${params.length})`);
    }

    const { rows } = await query(
      `SELECT
         r.id,
         r.guest_name,
         r.check_in,
         r.check_out,
         r.nights,
         r.status,
         r.payment_status,
         r.housekeeping_fees,
         u.id AS unit_id,
         COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
         COALESCE(u.project, u.compound) AS project
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.check_in DESC, r.id DESC`,
      params
    );

    const total = rows.reduce((s, r) => s + (parseFloat(r.housekeeping_fees) || 0), 0);
    const { rows: projectRows } = await query(
      `SELECT DISTINCT COALESCE(project, compound) AS project
       FROM units
       WHERE COALESCE(project, compound) IS NOT NULL
       ORDER BY 1`
    );

    res.json({
      summary: {
        total: Number(total.toFixed(2)),
        count: rows.length,
      },
      rows,
      projects: projectRows.map((p) => p.project).filter(Boolean),
    });
  } catch (e) {
    next(e);
  }
});
router.get('/reservations/blocked-dates', async (req, res, next) => {
  try {
    const unitId = req.query.unit_id;
    if (!unitId) return res.json([]);

    const params = [unitId];
    let excludeSql = '';
    if (req.query.exclude_id) {
      params.push(Number(req.query.exclude_id));
      excludeSql = `AND r.id <> $${params.length}`;
    }

    const { rows } = await query(
      `SELECT r.id,
              r.check_in::text AS check_in,
              r.check_out::text AS check_out,
              r.status,
              r.guest_name,
              r.is_owner_reservation,
              r.total_amount
       FROM public.reservations r
       WHERE r.unit_id = $1::uuid
         AND r.status <> 'cancelled'
         ${excludeSql}
       ORDER BY r.check_in`,
      params
    );

    
    let guestBlocked = [];
    try {
      const { rows: units } = await query(
        `SELECT wp_post_id FROM units WHERE id = $1::uuid`,
        [unitId]
      );
      const wp = units[0]?.wp_post_id;
      if (wp) {
        const { getBlockedDates } = require('../../services/pricing');
        const from = req.query.from || new Date().toISOString().slice(0, 10);
        const toDate = new Date(from);
        toDate.setMonth(toDate.getMonth() + 8);
        const to = req.query.to || toDate.toISOString().slice(0, 10);
        const blocked = await getBlockedDates(wp, from, to, { includeUnpriced: false });
        
        guestBlocked = blocked
          .filter((b) => b.source !== 'reservation')
          .map((b) => ({
          date: b.date,
          source: b.source,
          check_in: b.date,
          check_out: (() => {
            const [y, m, d] = b.date.split('-').map(Number);
            const next = new Date(y, m - 1, d + 1);
            const yy = next.getFullYear();
            const mm = String(next.getMonth() + 1).padStart(2, '0');
            const dd = String(next.getDate()).padStart(2, '0');
            return `${yy}-${mm}-${dd}`;
          })(),
          status: 'blocked',
          guest_name: b.source,
          is_owner_reservation: 0,
          total_amount: 0,
          _guest_block: true,
        }));
      }
    } catch (err) {
      console.warn('[blocked-dates] guest parity failed', err.message);
    }

    res.json([...rows, ...guestBlocked]);
  } catch (e) {
    next(e);
  }
});

router.post('/hr/deductions', requireRoles('admin', 'hr', 'hr_supervisor'), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO salary_deductions (employee_id, amount, reason, deduction_date, system_type, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [b.employee_id, b.amount, b.reason, b.deduction_date, b.system_type, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.put('/tasks/:id', async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `UPDATE tasks SET
         title = COALESCE($1, title),
         description = COALESCE($2, description),
         priority = COALESCE($3, priority),
         status = COALESCE($4, status),
         assigned_to = COALESCE($5, assigned_to),
         due_date = COALESCE($6, due_date),
         updated_at = now()
       WHERE id = $7 RETURNING *`,
      [b.title, b.description, b.priority, b.status, b.assigned_to, b.due_date, req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.put(
  '/reservations/:id',
  requireRoles(
    'reservations_manager',
    'reservations_manual',
    'reservations_web',
    'reservations',
    'operations',
    'operations_supervisor',
    'admin'
  ),
  async (req, res, next) => {
  
  try {
    const existing = await loadReservationAccess(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await assertReservationOwned(req.user, existing);

    const b = req.body;
    const { isAdmin, assertAssignableSalesPerson } = require('../../lib/reservationScope');
    
    if (!isAdmin(req.user)) {
      b.sales_person_id = req.user.id;
    }
    await assertAssignableSalesPerson(req.user, b.sales_person_id);
    const checkIn = b.check_in || existing.check_in;
    const checkOut = b.check_out || existing.check_out;
    const ci = new Date(checkIn);
    const co = new Date(checkOut);
    const nights = Math.max(1, Math.round((co - ci) / 86400000));
    const brokerPerNight =
      b.broker_amount_per_night !== undefined
        ? parseFloat(b.broker_amount_per_night) || 0
        : parseFloat(existing.broker_amount_per_night) || 0;
    const brokerTotal =
      b.broker_total !== undefined
        ? parseFloat(b.broker_total) || 0
        : brokerPerNight * nights;

    const clearHold =
      b.is_hold === false || b.is_hold === 0 || b.is_hold === '0' || b.is_hold === 'false';

    if (
      b.adults !== undefined ||
      b.children !== undefined ||
      b.nanny_count !== undefined ||
      b.nanny !== undefined
    ) {
      const adults =
        b.adults !== undefined && b.adults !== ''
          ? Math.max(0, parseInt(b.adults, 10) || 0)
          : Math.max(0, parseInt(existing.adults, 10) || 0);
      const children =
        b.children !== undefined && b.children !== ''
          ? Math.max(0, parseInt(b.children, 10) || 0)
          : Math.max(0, parseInt(existing.children, 10) || 0);
      const nannyCount =
        b.nanny_count !== undefined || b.nanny !== undefined
          ? Math.max(0, parseInt(b.nanny_count ?? b.nanny, 10) || 0)
          : Math.max(0, parseInt(existing.nanny_count, 10) || 0);
      const isOwner =
        b.is_owner_reservation !== undefined
          ? b.is_owner_reservation === true ||
            b.is_owner_reservation === 1 ||
            b.is_owner_reservation === '1'
          : !!existing.is_owner_reservation;
      if (!isOwner && adults < 1) {
        return res.status(400).json({ error: 'At least 1 adult is required' });
      }
      const unitId = b.unit_id || existing.unit_id;
      const { rows: unitRows } = await query(`SELECT guests FROM units WHERE id = $1`, [unitId]);
      const cap = Number(unitRows[0]?.guests);
      if (Number.isFinite(cap) && adults + children + nannyCount > cap) {
        return res
          .status(400)
          .json({ error: `Party size exceeds unit capacity (${cap})` });
      }
    }

    const { rows } = await query(
      `UPDATE reservations SET
         status = COALESCE($1, status),
         payment_status = COALESCE($2, payment_status),
         amount_paid = COALESCE($3, amount_paid),
         notes = COALESCE($4, notes),
         guest_name = COALESCE($5, guest_name),
         guest_email = COALESCE($6, guest_email),
         guest_phone = COALESCE($7, guest_phone),
         guest_nationality = COALESCE($8, guest_nationality),
         check_in = COALESCE($9, check_in),
         check_out = COALESCE($10, check_out),
         nights = COALESCE($11, nights),
         total_amount = COALESCE($12, total_amount),
         price_per_night = COALESCE($13, price_per_night),
         booking_source = COALESCE($14, booking_source),
         sales_person_id = COALESCE($15, sales_person_id),
         is_owner_reservation = COALESCE($16, is_owner_reservation),
         housekeeping_fees = COALESCE($17, housekeeping_fees),
         insurance = COALESCE($18, insurance),
         down_payment = COALESCE($19, down_payment),
         utilities_cost_override = COALESCE($20, utilities_cost_override),
         broker_name = COALESCE($21, broker_name),
         broker_amount_per_night = COALESCE($22, broker_amount_per_night),
         broker_total = COALESCE($23, broker_total),
         owner_collected_type = COALESCE($24, owner_collected_type),
         owner_collected_amount = COALESCE($25, owner_collected_amount),
         payment_method = COALESCE($26, payment_method),
         unit_id = COALESCE($27, unit_id),
         hold_expires_at = CASE WHEN $28::boolean THEN NULL ELSE hold_expires_at END,
         adults = COALESCE($30, adults),
         children = COALESCE($31, children),
         nanny_count = COALESCE($32, nanny_count),
         sales_label = COALESCE($33, sales_label),
         utilities_amount = COALESCE($34, utilities_amount),
         beach_access_fees = COALESCE($35, beach_access_fees),
         updated_at = now()
       WHERE id = $29 RETURNING *`,
      [
        b.status ?? null,
        b.payment_status ?? null,
        b.amount_paid != null && b.amount_paid !== '' ? parseFloat(b.amount_paid) : null,
        b.notes ?? null,
        b.guest_name ?? null,
        b.guest_email ?? null,
        b.guest_phone ?? null,
        b.guest_nationality ?? null,
        b.check_in ?? null,
        b.check_out ?? null,
        b.check_in || b.check_out ? nights : null,
        b.total_amount != null && b.total_amount !== '' ? parseFloat(b.total_amount) : null,
        b.price_per_night != null && b.price_per_night !== '' ? parseFloat(b.price_per_night) : null,
        b.booking_source ?? null,
        b.sales_person_id || null,
        b.is_owner_reservation !== undefined
          ? (b.is_owner_reservation === true || b.is_owner_reservation === 1 || b.is_owner_reservation === '1' ? 1 : 0)
          : null,
        b.housekeeping_fees != null && b.housekeeping_fees !== '' ? parseFloat(b.housekeeping_fees) : null,
        b.insurance != null && b.insurance !== '' ? parseFloat(b.insurance) : null,
        b.down_payment != null && b.down_payment !== '' ? parseFloat(b.down_payment) : null,
        b.utilities_cost_override !== undefined
          ? (b.utilities_cost_override === '' || b.utilities_cost_override == null
              ? null
              : parseFloat(b.utilities_cost_override))
          : null,
        b.broker_name ?? null,
        b.broker_amount_per_night !== undefined ? brokerPerNight : null,
        b.broker_amount_per_night !== undefined || b.broker_total !== undefined ? brokerTotal : null,
        b.owner_collected_type !== undefined ? (b.owner_collected_type || null) : null,
        b.owner_collected_amount !== undefined ? parseFloat(b.owner_collected_amount) || 0 : null,
        b.payment_method ?? null,
        b.unit_id ?? null,
        clearHold,
        req.params.id,
        b.adults !== undefined && b.adults !== '' ? Math.max(0, parseInt(b.adults, 10) || 0) : null,
        b.children !== undefined && b.children !== '' ? Math.max(0, parseInt(b.children, 10) || 0) : null,
        b.nanny_count !== undefined || b.nanny !== undefined
          ? Math.max(0, parseInt(b.nanny_count ?? b.nanny, 10) || 0)
          : null,
        b.sales_label !== undefined || b.sales_owner !== undefined
          ? (() => {
              const { resolveSalesLabel } = require('../../lib/salesNameMatch');
              return resolveSalesLabel(b.sales_label ?? b.sales_owner ?? '');
            })()
          : null,
        b.utilities_amount != null && b.utilities_amount !== ''
          ? parseFloat(b.utilities_amount) || 0
          : null,
        b.beach_access_fees != null && b.beach_access_fees !== ''
          ? parseFloat(b.beach_access_fees) || 0
          : null,
      ]
    );
    try {
      const { resyncReservationBlocks } = require('../../lib/reservationBlocks');
      await resyncReservationBlocks(existing, rows[0]);
    } catch (err) {
      console.warn('[reservations] block resync failed', err.message);
    }
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.put('/auth/change-password', async (req, res, next) => {
  try {
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    const { passwordPolicyOk, passwordPolicyMessage } = require('../../lib/staffIdentity');
    const { staffTokenVersion } = require('../../lib/staffAuthSessions');
    const { currentPassword, newPassword, current_password, new_password } = req.body;
    const cur = currentPassword || current_password;
    const neu = newPassword || new_password;
    if (!cur || !neu) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (!passwordPolicyOk(neu, req.user.email)) {
      return res.status(400).json({ error: passwordPolicyMessage() });
    }
    const { rows } = await query(`SELECT password_hash FROM staff_users WHERE id = $1`, [req.user.id]);
    if (!(await bcrypt.compare(cur, rows[0].password_hash))) {
      return res.status(400).json({ error: 'Current password incorrect' });
    }
    const hash = await bcrypt.hash(neu, 10);
    const { rows: updated } = await query(
      `UPDATE staff_users
       SET password_hash = $1,
           is_first_login = 0,
           auth_token_version = COALESCE(auth_token_version, 0) + 1,
           updated_at = now()
       WHERE id = $2
       RETURNING id, role, COALESCE(auth_token_version, 0)::int AS auth_token_version`,
      [hash, req.user.id]
    );
    const token = jwt.sign(
      {
        kind: 'staff',
        sub: updated[0].id,
        role: updated[0].role,
        tv: staffTokenVersion(updated[0]),
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    res.json({ ok: true, token });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
