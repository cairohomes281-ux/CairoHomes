const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const {
  isFinanceManager,
  isAdmin,
  FINANCE_AGENT_ROLES,
} = require('../../lib/financeScope');

const router = express.Router();

const CAIRO_TODAY = `(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date`;
const CAIRO_CREATED_DATE = `(created_at AT TIME ZONE 'Africa/Cairo')::date`;
const CAIRO_REVIEWED_DATE = `(reviewed_at AT TIME ZONE 'Africa/Cairo')::date`;
const CAIRO_REFUND_DATE = `(insurance_refunded_at AT TIME ZONE 'Africa/Cairo')::date`;
const CAIRO_CLOSED_DATE = `(closed_at AT TIME ZONE 'Africa/Cairo')::date`;

function isoDate(d) {
  return String(d || '').slice(0, 10);
}

function eventTime(row, field = 'created_at') {
  const stamp = row?.[field];
  if (!stamp) return '';
  const text = String(stamp);
  const m = text.match(/(?:T| )(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

async function safeQuery(sql, params) {
  try {
    const { rows } = await query(sql, params);
    return rows;
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') return [];
    throw err;
  }
}

router.get('/finance-audit', requireRoles('admin', 'finance_manager'), async (req, res, next) => {
  try {
    if (!isAdmin(req.user) && !isFinanceManager(req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { rows: todayRows } = await query(`SELECT ${CAIRO_TODAY} AS today`);
    const today = isoDate(todayRows[0]?.today);
    const date = isoDate(req.query.date) || today;
    const admin = isAdmin(req.user);

    const teamSql = admin
      ? `SELECT id, full_name, role FROM staff_users
         WHERE is_active = 1 AND role = ANY($1::text[])
         ORDER BY full_name`
      : `SELECT id, full_name, role FROM staff_users
         WHERE is_active = 1
           AND (id = $1 OR manager_id = $1)
           AND role = ANY($2::text[])
         ORDER BY full_name`;

    const teamQueryParams = admin ? [FINANCE_AGENT_ROLES] : [req.user.id, FINANCE_AGENT_ROLES];
    const { rows: team } = await query(teamSql, teamQueryParams);

    if (!team.length) {
      return res.json({
        date,
        today,
        totals: { events: 0, team_size: 0, agents_active: 0 },
        by_agent: [],
        events: [],
      });
    }

    const teamIds = team.map((row) => row.id);
    const events = [];

    const manualRows = await safeQuery(
      `SELECT id, created_by AS user_id, entry_type, description, amount, created_at
       FROM financial_manual_entries
       WHERE created_by = ANY($1::int[])
         AND ${CAIRO_CREATED_DATE} = $2::date`,
      [teamIds, date]
    );
    for (const row of manualRows) {
      events.push({
        id: `manual-${row.id}`,
        user_id: row.user_id,
        action: 'MANUAL_ENTRY',
        entity_type: row.entry_type,
        entity_id: row.id,
        details: {
          description: row.description,
          amount: row.amount,
          entry_type: row.entry_type,
        },
        created_at: row.created_at,
        cairo_time: eventTime(row),
      });
    }

    const payoutRows = await safeQuery(
      `SELECT id, reviewed_by AS user_id, amount, reviewed_at AS created_at
       FROM owner_payout_requests
       WHERE reviewed_by = ANY($1::int[])
         AND status = 'paid'
         AND ${CAIRO_REVIEWED_DATE} = $2::date`,
      [teamIds, date]
    );
    for (const row of payoutRows) {
      events.push({
        id: `payout-${row.id}`,
        user_id: row.user_id,
        action: 'PAYOUT_SETTLED',
        entity_type: 'owner_payout',
        entity_id: row.id,
        details: { amount: row.amount },
        created_at: row.created_at,
        cairo_time: eventTime(row),
      });
    }

    const holdbackRows = await safeQuery(
      `SELECT id, created_by AS user_id, amount, reason, created_at
       FROM financial_owner_holdbacks
       WHERE created_by = ANY($1::int[])
         AND ${CAIRO_CREATED_DATE} = $2::date`,
      [teamIds, date]
    );
    for (const row of holdbackRows) {
      events.push({
        id: `holdback-${row.id}`,
        user_id: row.user_id,
        action: 'HOLDBACK_CREATED',
        entity_type: 'holdback',
        entity_id: row.id,
        details: { amount: row.amount, reason: row.reason },
        created_at: row.created_at,
        cairo_time: eventTime(row),
      });
    }

    const bankRows = await safeQuery(
      `SELECT id, created_by AS user_id, account_code, statement_balance, created_at
       FROM financial_bank_snapshots
       WHERE created_by = ANY($1::int[])
         AND ${CAIRO_CREATED_DATE} = $2::date`,
      [teamIds, date]
    );
    for (const row of bankRows) {
      events.push({
        id: `bank-${row.id}`,
        user_id: row.user_id,
        action: 'BANK_SNAPSHOT',
        entity_type: 'bank_snapshot',
        entity_id: row.id,
        details: {
          account_code: row.account_code,
          statement_balance: row.statement_balance,
        },
        created_at: row.created_at,
        cairo_time: eventTime(row),
      });
    }

    const refundRows = await safeQuery(
      `SELECT id, insurance_refunded_by AS user_id, insurance_refunded_amount, insurance_damage_amount,
              insurance_refunded_at AS created_at
       FROM reservations
       WHERE insurance_refunded_by = ANY($1::int[])
         AND ${CAIRO_REFUND_DATE} = $2::date`,
      [teamIds, date]
    );
    for (const row of refundRows) {
      events.push({
        id: `insurance-${row.id}`,
        user_id: row.user_id,
        action: 'INSURANCE_REFUND',
        entity_type: 'reservation',
        entity_id: row.id,
        details: {
          refunded_amount: row.insurance_refunded_amount,
          damage_amount: row.insurance_damage_amount,
        },
        created_at: row.created_at,
        cairo_time: eventTime(row),
      });
    }

    const closeRows = await safeQuery(
      `SELECT year_month, closed_by AS user_id, pnl_amount, closed_at AS created_at
       FROM financial_period_closes
       WHERE closed_by = ANY($1::int[])
         AND ${CAIRO_CLOSED_DATE} = $2::date`,
      [teamIds, date]
    );
    for (const row of closeRows) {
      events.push({
        id: `period-${row.year_month}-${row.user_id}`,
        user_id: row.user_id,
        action: 'PERIOD_CLOSED',
        entity_type: 'period',
        entity_id: row.year_month,
        details: { pnl_amount: row.pnl_amount, year_month: row.year_month },
        created_at: row.created_at,
        cairo_time: eventTime(row),
      });
    }

    events.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const nameById = new Map(team.map((member) => [Number(member.id), member]));
    const mappedEvents = events.map((event) => {
      const member = nameById.get(Number(event.user_id));
      return {
        ...event,
        full_name: member?.full_name || '',
        role: member?.role || '',
      };
    });

    const byAgentMap = new Map(
      team.map((member) => [
        Number(member.id),
        {
          staff_id: member.id,
          full_name: member.full_name,
          role: member.role,
          count: 0,
          events: [],
        },
      ])
    );

    for (const event of mappedEvents) {
      const bucket = byAgentMap.get(Number(event.user_id));
      if (!bucket) continue;
      bucket.count += 1;
      bucket.events.push(event);
    }

    const by_agent = [...byAgentMap.values()].sort(
      (a, b) => b.count - a.count || String(a.full_name).localeCompare(String(b.full_name))
    );

    res.json({
      date,
      today,
      totals: {
        events: mappedEvents.length,
        team_size: team.length,
        agents_active: by_agent.filter((row) => row.count > 0).length,
      },
      by_agent,
      events: mappedEvents,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
