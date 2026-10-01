/**
 * Admin analytics reports — revenue, by employee/unit, daily pivot, Excel export.
 * Adapted for Cairo Homes schema (units.title, staff_users, FINANCIAL_EPOCH, website channel).
 */
const express = require('express');
const XLSX = require('xlsx');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { clampFromDate, FINANCIAL_EPOCH } = require('../../lib/financialEpoch');
const { calcReservationFinancials, round2 } = require('../../lib/commission');
const { isWebsiteOriginReservation } = require('../../lib/reservationScope');
const { resolveReservationSalesPerson } = require('../../lib/salesNameMatch');

const router = express.Router();

// Per-route admin gate only — do NOT use router.use(requireRoles(...)) here.
// This module is mounted at /api/pms without a path prefix; a router-level role
// middleware would 403 every PMS request for non-admin roles (ops, HK, agents).

const RESERVATIONS_TEAM_ROLES = ['reservations', 'reservations_web', 'reservations_manual'];

const WEBSITE_CHANNEL_SQL = `
  r.booking_id IS NOT NULL
  OR lower(btrim(COALESCE(r.booking_source, ''))) IN ('website', 'web')
`;

const ACTIVE_STAY_SQL = `
  r.status <> 'cancelled'
  AND NOT (
    COALESCE(r.is_owner_reservation, 0)::int = 1
    AND COALESCE(r.total_amount, 0) = 0
  )
`;

const CAIRO_CREATED_DATE_SQL = `(r.created_at AT TIME ZONE 'Africa/Cairo')::date`;

function dateExprSql(alias, dateField) {
  if (dateField === 'created_at') {
    return alias === 'r' ? CAIRO_CREATED_DATE_SQL : `(${alias}.created_at AT TIME ZONE 'Africa/Cairo')::date`;
  }
  return `${alias}.check_in`;
}

function reportFilters(req, { alias = 'r', includeProject = true, dateField = 'check_in' } = {}) {
  const from = clampFromDate(req.query.from_date);
  const to = req.query.to_date || null;
  const project = includeProject ? String(req.query.project || '').trim() : '';
  const params = [];
  let sql = ` AND ${alias}.status <> 'cancelled'`;
  sql += ` AND NOT (
    COALESCE(${alias}.is_owner_reservation, 0)::int = 1
    AND COALESCE(${alias}.total_amount, 0) = 0
  )`;
  const dateExpr = dateExprSql(alias, dateField);
  if (from) {
    params.push(from);
    sql += ` AND ${dateExpr} >= $${params.length}::date`;
  }
  if (to) {
    params.push(to);
    sql += ` AND ${dateExpr} <= $${params.length}::date`;
  }
  if (project) {
    params.push(project);
    sql += ` AND COALESCE(u.project, u.compound) = $${params.length}`;
  }
  return { sql, params, from, to, project };
}

function channelOf(row) {
  return isWebsiteOriginReservation(row) ? 'website' : 'manual';
}

function channelLabel(key) {
  return String(key || '').toLowerCase() === 'website' ? 'Website' : 'Manual';
}

function parseMonthParam(raw) {
  const match = String(raw || '').trim().match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const year = match ? parseInt(match[1], 10) : now.getFullYear();
  const month = match ? parseInt(match[2], 10) : now.getMonth() + 1;
  if (month < 1 || month > 12) throw new Error('Invalid month');
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const monthStart = `${monthKey}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  return { month: monthKey, from_date: monthStart, to_date: monthEnd };
}

function parseLeaderboardPeriod(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'all' || value === 'all-time') {
    return { month: 'all', from_date: null, to_date: null };
  }
  return parseMonthParam(raw);
}

function mapLeaderboardRow(row, rank) {
  return {
    rank,
    id: row.id,
    full_name: row.full_name,
    role: row.role,
    reservation_count: row.reservation_count,
    website_count: row.website_count,
    manual_count: row.manual_count,
    total_amount: round2(parseFloat(row.total_amount) || 0),
    website_amount: round2(parseFloat(row.website_amount) || 0),
    manual_amount: round2(parseFloat(row.manual_amount) || 0),
  };
}

function aggregateBySalesPerson(stays, staffList) {
  const buckets = new Map();
  for (const stay of stays) {
    const staff = resolveReservationSalesPerson(stay, staffList);
    if (!staff) continue;
    const key = String(staff.id);
    if (!buckets.has(key)) {
      buckets.set(key, {
        id: staff.id,
        full_name: staff.full_name,
        role: staff.role,
        reservation_count: 0,
        website_count: 0,
        manual_count: 0,
        total_amount: 0,
        website_amount: 0,
        manual_amount: 0,
      });
    }
    const row = buckets.get(key);
    const amount = parseFloat(stay.total_amount) || 0;
    const website = isWebsiteOriginReservation(stay);
    row.reservation_count += 1;
    row.total_amount += amount;
    if (website) {
      row.website_count += 1;
      row.website_amount += amount;
    } else {
      row.manual_count += 1;
      row.manual_amount += amount;
    }
  }
  return [...buckets.values()];
}

/** GET /reports/revenue */
router.get('/reports/revenue', requireRoles('admin'), async (req, res, next) => {
  try {
    const { sql: dateSql, params, from, to, project } = reportFilters(req);

    const { rows } = await query(
      `SELECT r.*,
              to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
              to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
              COALESCE(u.project, u.compound) AS project,
              u.unit_number,
              u.commission_mode, u.company_commission_pct,
              u.company_commission_owner_pct, u.commission_tenant_pct,
              su.full_name AS sales_person_name
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users su ON su.id = r.sales_person_id
       WHERE TRUE
         ${dateSql}
       ORDER BY r.check_in DESC`,
      params
    );

    const enriched = rows.map((r) => ({
      ...r,
      booking_channel: channelOf(r),
      booking_channel_label: channelLabel(channelOf(r)),
    }));

    const totalRevenue = enriched.reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0);
    const totalPaid = enriched.reduce((s, r) => s + (parseFloat(r.amount_paid) || 0), 0);
    const websiteRows = enriched.filter((r) => r.booking_channel === 'website');
    const manualRows = enriched.filter((r) => r.booking_channel !== 'website');

    // Pending website booking requests in the same check-in window
    const pendingParams = [from || FINANCIAL_EPOCH];
    let pendingSql = `b.status = 'pending' AND b.checkin >= $1::date`;
    if (to) {
      pendingParams.push(to);
      pendingSql += ` AND b.checkin <= $${pendingParams.length}::date`;
    }
    const { rows: pendingReq } = await query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(total_egp), 0)::float AS total
       FROM bookings b
       WHERE ${pendingSql}`,
      pendingParams
    );

    res.json({
      reservations: enriched,
      summary: {
        totalRevenue: round2(totalRevenue),
        totalPaid: round2(totalPaid),
        totalPending: round2(totalRevenue - totalPaid),
        count: enriched.length,
        website_count: websiteRows.length,
        website_revenue: round2(
          websiteRows.reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0)
        ),
        manual_count: manualRows.length,
        manual_revenue: round2(
          manualRows.reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0)
        ),
        pending_website_requests: pendingReq[0]?.count || 0,
        pending_website_requests_value: round2(Number(pendingReq[0]?.total) || 0),
        financial_epoch: FINANCIAL_EPOCH,
        from_date: from,
        to_date: to,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** GET /reports/by-employee */
router.get('/reports/by-employee', requireRoles('admin'), async (req, res, next) => {
  try {
    const { sql: dateSql, params } = reportFilters(req);
    const [{ rows: staff }, { rows: stays }] = await Promise.all([
      query(`SELECT id, full_name, role FROM staff_users`),
      query(
        `SELECT r.sales_person_id, r.sales_label, r.total_amount, r.booking_id, r.booking_source
         FROM reservations r
         JOIN units u ON u.id = r.unit_id
         WHERE TRUE
           ${dateSql}`,
        params
      ),
    ]);
    const employees = aggregateBySalesPerson(stays, staff)
      .sort((a, b) => b.total_amount - a.total_amount)
      .map((e) => ({
        ...e,
        total_amount: round2(e.total_amount),
        website_amount: round2(e.website_amount),
        manual_amount: round2(e.manual_amount),
      }));
    res.json({ employees });
  } catch (e) {
    next(e);
  }
});

/** GET /reports/monthly-leaderboard — reservations team, website + manual split */
router.get('/reports/monthly-leaderboard', requireRoles('admin'), async (req, res, next) => {
  try {
    const { month, from_date, to_date } = parseLeaderboardPeriod(req.query.month);
    const stayParams = [];
    let staySql = `SELECT r.sales_person_id, r.sales_label, r.total_amount, r.booking_id, r.booking_source
         FROM reservations r
         WHERE ${ACTIVE_STAY_SQL}`;
    if (from_date) {
      stayParams.push(from_date);
      staySql += ` AND ${CAIRO_CREATED_DATE_SQL} >= $${stayParams.length}::date`;
    }
    if (to_date) {
      stayParams.push(to_date);
      staySql += ` AND ${CAIRO_CREATED_DATE_SQL} <= $${stayParams.length}::date`;
    }
    const [{ rows: team }, { rows: stays }] = await Promise.all([
      query(
        `SELECT id, full_name, role
         FROM staff_users
         WHERE role = ANY($1::text[])`,
        [RESERVATIONS_TEAM_ROLES]
      ),
      query(staySql, stayParams),
    ]);

    const leaderboard = aggregateBySalesPerson(stays, team)
      .sort((a, b) => {
        if (b.reservation_count !== a.reservation_count) return b.reservation_count - a.reservation_count;
        if (b.total_amount !== a.total_amount) return b.total_amount - a.total_amount;
        return String(a.full_name || '').localeCompare(String(b.full_name || ''));
      })
      .map((row, idx) => mapLeaderboardRow(row, idx + 1));
    const totals = leaderboard.reduce(
      (acc, row) => {
        acc.reservation_count += row.reservation_count;
        acc.website_count += row.website_count;
        acc.manual_count += row.manual_count;
        acc.total_amount += row.total_amount;
        acc.website_amount += row.website_amount;
        acc.manual_amount += row.manual_amount;
        return acc;
      },
      {
        reservation_count: 0,
        website_count: 0,
        manual_count: 0,
        total_amount: 0,
        website_amount: 0,
        manual_amount: 0,
      }
    );

    res.json({
      month,
      from_date,
      to_date,
      date_field: 'created_at',
      timezone: 'Africa/Cairo',
      roles: RESERVATIONS_TEAM_ROLES,
      leaderboard,
      totals: {
        reservation_count: totals.reservation_count,
        website_count: totals.website_count,
        manual_count: totals.manual_count,
        total_amount: round2(totals.total_amount),
        website_amount: round2(totals.website_amount),
        manual_amount: round2(totals.manual_amount),
      },
    });
  } catch (e) {
    if (e.message === 'Invalid month') return res.status(400).json({ error: e.message });
    next(e);
  }
});

/** GET /reports/by-unit */
router.get('/reports/by-unit', requireRoles('admin'), async (req, res, next) => {
  try {
    const { sql: dateSql, params } = reportFilters(req);
    const { rows } = await query(
      `SELECT
         r.id, r.nights, r.total_amount,
         r.price_per_night, r.is_owner_reservation, r.booking_id, r.booking_source,
         r.broker_total, r.broker_amount_per_night,
         u.id AS unit_id,
         COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
         COALESCE(u.project, u.compound) AS project,
         u.commission_mode,
         u.company_commission_pct,
         u.company_commission_owner_pct,
         u.commission_tenant_pct
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE TRUE
         ${dateSql}`,
      params
    );

    const unitMap = {};
    for (const r of rows) {
      const fin = calcReservationFinancials(
        {
          commission_mode: r.commission_mode,
          company_commission_pct: r.company_commission_pct,
          company_commission_owner_pct: r.company_commission_owner_pct,
          commission_tenant_pct: r.commission_tenant_pct,
        },
        r
      );
      if (!unitMap[r.unit_id]) {
        unitMap[r.unit_id] = {
          unit_id: r.unit_id,
          unit_name: r.unit_name,
          project: r.project,
          reservation_count: 0,
          website_count: 0,
          total_nights: 0,
          total_gross: 0,
          total_owner_net: 0,
          total_company_commission: 0,
        };
      }
      const u = unitMap[r.unit_id];
      u.reservation_count += 1;
      if (channelOf(r) === 'website') u.website_count += 1;
      u.total_nights += parseInt(r.nights, 10) || 0;
      u.total_gross += parseFloat(r.total_amount) || 0;
      u.total_owner_net += fin.ownerNet;
      u.total_company_commission += fin.companyCommission;
    }

    const units = Object.values(unitMap)
      .sort((a, b) => b.total_gross - a.total_gross)
      .map((u) => ({
        ...u,
        total_gross: round2(u.total_gross),
        total_owner_net: round2(u.total_owner_net),
        total_company_commission: round2(u.total_company_commission),
      }));

    res.json({ units });
  } catch (e) {
    next(e);
  }
});

/** GET /reports/daily-reservations — pivot by creation date × project */
router.get('/reports/daily-reservations', requireRoles('admin'), async (req, res, next) => {
  try {
    const { sql: dateSql, params } = reportFilters(req, { dateField: 'created_at' });

    const { rows } = await query(
      `SELECT
         to_char(${CAIRO_CREATED_DATE_SQL}, 'YYYY-MM-DD') AS date,
         COALESCE(u.project, u.compound, 'Unassigned') AS project,
         COUNT(r.id)::int AS count,
         COALESCE(SUM(r.total_amount), 0)::float AS amount,
         COUNT(*) FILTER (WHERE ${WEBSITE_CHANNEL_SQL})::int AS website_count
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       WHERE TRUE
         ${dateSql}
       GROUP BY ${CAIRO_CREATED_DATE_SQL},
                COALESCE(u.project, u.compound, 'Unassigned')
       ORDER BY date DESC, project`,
      params
    );

    const projects = [...new Set(rows.map((r) => r.project).filter(Boolean))].sort();
    const dateMap = {};
    for (const r of rows) {
      const d = String(r.date).split('T')[0];
      if (!dateMap[d]) {
        dateMap[d] = { date: d, total: 0, total_amount: 0, website_total: 0 };
      }
      dateMap[d][r.project] = (dateMap[d][r.project] || 0) + r.count;
      dateMap[d][`${r.project}_amount`] =
        (dateMap[d][`${r.project}_amount`] || 0) + parseFloat(r.amount);
      dateMap[d].total += r.count;
      dateMap[d].total_amount += parseFloat(r.amount);
      dateMap[d].website_total += r.website_count || 0;
    }

    const daily = Object.values(dateMap).sort((a, b) => b.date.localeCompare(a.date));
    res.json({ daily, projects, financial_epoch: FINANCIAL_EPOCH });
  } catch (e) {
    next(e);
  }
});

/** GET /reports/export/reservations/excel */
router.get('/reports/export/reservations/excel', requireRoles('admin'), async (req, res, next) => {
  try {
    const { sql: dateSql, params } = reportFilters(req);
    const { rows } = await query(
      `SELECT r.id,
              r.guest_name,
              r.guest_phone,
              to_char(r.check_in, 'YYYY-MM-DD') AS check_in,
              to_char(r.check_out, 'YYYY-MM-DD') AS check_out,
              r.nights,
              r.total_amount,
              r.amount_paid,
              r.payment_status,
              r.booking_source,
              r.booking_id,
              r.status,
              r.is_owner_reservation,
              COALESCE(u.unit_number, u.title) AS unit,
              COALESCE(u.project, u.compound) AS project,
              su.full_name AS sales_person
       FROM reservations r
       JOIN units u ON u.id = r.unit_id
       LEFT JOIN staff_users su ON su.id = r.sales_person_id
       WHERE TRUE
         ${dateSql}
       ORDER BY r.check_in DESC`,
      params
    );

    const sheetRows = rows.map((r) => ({
      ID: r.id,
      Guest: r.guest_name,
      Phone: r.guest_phone,
      'Check-in': r.check_in,
      'Check-out': r.check_out,
      Nights: r.nights,
      Total: Number(r.total_amount) || 0,
      Paid: Number(r.amount_paid) || 0,
      'Payment status': r.payment_status,
      Channel: channelLabel(channelOf(r)),
      Source: r.booking_source || '',
      Status: r.status,
      'Owner stay': r.is_owner_reservation ? 'Yes' : 'No',
      Unit: r.unit,
      Project: r.project,
      Agent: r.sales_person,
    }));

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reservations');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cairo-homes-reservations-${params[0] || 'all'}.xlsx"`
    );
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
