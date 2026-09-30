const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { isResaleManager, isAdmin, RESALE_AGENT_ROLES } = require('../../lib/resaleScope');

const router = express.Router();

const CAIRO_TODAY = `(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date`;
const UNIT_CREATED_DATE = `(u.created_at AT TIME ZONE 'Africa/Cairo')::date`;
const SALE_SIGNED_DATE = `(al.updated_at AT TIME ZONE 'Africa/Cairo')::date`;

function isoDate(d) {
  return String(d || '').slice(0, 10);
}

function addDays(iso, n) {
  const dt = new Date(`${iso}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function defaultRange() {
  const to = new Date().toISOString().slice(0, 10);
  const fromDt = new Date(`${to}T12:00:00Z`);
  fromDt.setUTCDate(fromDt.getUTCDate() - 29);
  return { from: fromDt.toISOString().slice(0, 10), to };
}

router.get('/resale-performance', requireRoles('admin'), async (req, res, next) => {
  try {
    if (!isAdmin(req.user) && !isResaleManager(req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const defaults = defaultRange();
    const from = isoDate(req.query.from_date) || defaults.from;
    const to = isoDate(req.query.to_date) || defaults.to;
    const admin = isAdmin(req.user);

    const teamSql = admin
      ? `SELECT id, full_name, role FROM staff_users
         WHERE is_active = 1 AND role = ANY($1::text[])`
      : `SELECT id, full_name, role FROM staff_users
         WHERE is_active = 1
           AND (id = $1 OR manager_id = $1)
           AND role = ANY($2::text[])`;

    const teamQueryParams = admin ? [RESALE_AGENT_ROLES] : [req.user.id, RESALE_AGENT_ROLES];
    const { rows: team } = await query(teamSql, teamQueryParams);

    if (!team.length) {
      return res.json({
        from,
        to,
        today: null,
        totals: {
          units_total: 0,
          units_today: 0,
          sales_total: 0,
          sales_today: 0,
          team_size: 0,
        },
        daily_units: [],
        daily_sales: [],
        leaderboard: [],
      });
    }

    const teamIds = team.map((row) => row.id);
    const { rows: todayRows } = await query(`SELECT ${CAIRO_TODAY} AS today`);
    const today = isoDate(todayRows[0]?.today);

    const { rows: unitCounts } = await query(
      `SELECT u.created_by_staff AS staff_id, ${UNIT_CREATED_DATE} AS day, COUNT(*)::int AS cnt
       FROM units u
       WHERE COALESCE(u.listing_type, 'rent') = 'sale'
         AND u.created_by_staff = ANY($3::int[])
         AND ${UNIT_CREATED_DATE} BETWEEN $1::date AND $2::date
       GROUP BY 1, 2`,
      [from, to, teamIds]
    );

    const { rows: unitTodayCounts } = await query(
      `SELECT u.created_by_staff AS staff_id, COUNT(*)::int AS cnt
       FROM units u
       WHERE COALESCE(u.listing_type, 'rent') = 'sale'
         AND u.created_by_staff = ANY($1::int[])
         AND ${UNIT_CREATED_DATE} = ${CAIRO_TODAY}
       GROUP BY 1`,
      [teamIds]
    );

    const { rows: saleCounts } = await query(
      `SELECT al.created_by AS staff_id, ${SALE_SIGNED_DATE} AS day, COUNT(*)::int AS cnt
       FROM acquisition_leads al
       WHERE al.stage = 'signed'
         AND al.created_by = ANY($3::int[])
         AND ${SALE_SIGNED_DATE} BETWEEN $1::date AND $2::date
       GROUP BY 1, 2`,
      [from, to, teamIds]
    );

    const { rows: saleTodayCounts } = await query(
      `SELECT al.created_by AS staff_id, COUNT(*)::int AS cnt
       FROM acquisition_leads al
       WHERE al.stage = 'signed'
         AND al.created_by = ANY($1::int[])
         AND ${SALE_SIGNED_DATE} = ${CAIRO_TODAY}
       GROUP BY 1`,
      [teamIds]
    );

    const unitsByStaff = new Map();
    const unitsTodayByStaff = new Map(unitTodayCounts.map((r) => [Number(r.staff_id), Number(r.cnt)]));
    const unitsByDay = new Map();

    for (const row of unitCounts) {
      const staffId = Number(row.staff_id);
      const day = isoDate(row.day);
      const cnt = Number(row.cnt) || 0;
      unitsByStaff.set(staffId, (unitsByStaff.get(staffId) || 0) + cnt);
      unitsByDay.set(day, (unitsByDay.get(day) || 0) + cnt);
    }

    const salesByStaff = new Map();
    const salesTodayByStaff = new Map(saleTodayCounts.map((r) => [Number(r.staff_id), Number(r.cnt)]));
    const salesByDay = new Map();

    for (const row of saleCounts) {
      const staffId = Number(row.staff_id);
      const day = isoDate(row.day);
      const cnt = Number(row.cnt) || 0;
      salesByStaff.set(staffId, (salesByStaff.get(staffId) || 0) + cnt);
      salesByDay.set(day, (salesByDay.get(day) || 0) + cnt);
    }

    const daily_units = [];
    const daily_sales = [];
    if (from && to && from <= to) {
      for (let d = from; d <= to; d = addDays(d, 1)) {
        daily_units.push({ date: d, count: unitsByDay.get(d) || 0 });
        daily_sales.push({ date: d, count: salesByDay.get(d) || 0 });
        if (daily_units.length > 366) break;
      }
    }

    const leaderboard = team
      .map((member) => {
        const id = Number(member.id);
        const units_total = unitsByStaff.get(id) || 0;
        const sales_total = salesByStaff.get(id) || 0;
        return {
          staff_id: member.id,
          full_name: member.full_name,
          role: member.role,
          units_total,
          units_today: unitsTodayByStaff.get(id) || 0,
          sales_total,
          sales_today: salesTodayByStaff.get(id) || 0,
          total: units_total + sales_total,
        };
      })
      .sort(
        (a, b) =>
          b.sales_total - a.sales_total ||
          b.units_total - a.units_total ||
          String(a.full_name).localeCompare(String(b.full_name))
      );

    const totals = {
      units_total: leaderboard.reduce((sum, row) => sum + row.units_total, 0),
      units_today: leaderboard.reduce((sum, row) => sum + row.units_today, 0),
      sales_total: leaderboard.reduce((sum, row) => sum + row.sales_total, 0),
      sales_today: leaderboard.reduce((sum, row) => sum + row.sales_today, 0),
      team_size: team.length,
    };

    res.json({ from, to, today, totals, daily_units, daily_sales, leaderboard });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
