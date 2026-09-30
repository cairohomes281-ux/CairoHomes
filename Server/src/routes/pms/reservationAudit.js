const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const {
  isAdmin,
  isReservationsManager,
  RESERVATION_AUDIT_TEAM_ROLES,
  RESERVATION_AUDIT_ACTIONS,
} = require('../../lib/reservationScope');

const router = express.Router();

const CAIRO_TODAY = `(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date`;
const CAIRO_CREATED_DATE = `(a.created_at AT TIME ZONE 'Africa/Cairo')::date`;

function isoDate(d) {
  return String(d || '').slice(0, 10);
}

router.get(
  '/reservation-audit',
  requireRoles('admin', 'reservations_manager'),
  async (req, res, next) => {
    try {
      if (!isAdmin(req.user) && !isReservationsManager(req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { rows: todayRows } = await query(`SELECT ${CAIRO_TODAY} AS today`);
      const today = isoDate(todayRows[0]?.today);
      const date = isoDate(req.query.date) || today;
      const admin = isAdmin(req.user);

      const teamSql = admin
        ? `SELECT id, full_name, role FROM staff_users
           WHERE role = ANY($1::text[])
           ORDER BY full_name`
        : `SELECT id, full_name, role FROM staff_users
           WHERE (id = $1 OR manager_id = $1)
             AND role = ANY($2::text[])
           ORDER BY full_name`;

      const teamQueryParams = admin
        ? [RESERVATION_AUDIT_TEAM_ROLES]
        : [req.user.id, RESERVATION_AUDIT_TEAM_ROLES];
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
      const { rows: events } = await query(
        `SELECT
           a.id,
           a.user_id,
           a.action,
           a.entity_type,
           a.entity_id,
           a.details,
           a.created_at,
           to_char(a.created_at AT TIME ZONE 'Africa/Cairo', 'HH24:MI') AS cairo_time,
           s.full_name,
           s.role
         FROM audit_log a
         LEFT JOIN staff_users s ON s.id = a.user_id
         WHERE a.user_id = ANY($1::int[])
           AND a.action = ANY($2::text[])
           AND ${CAIRO_CREATED_DATE} = $3::date
         ORDER BY a.created_at DESC`,
        [teamIds, RESERVATION_AUDIT_ACTIONS, date]
      );

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

      const mappedEvents = events.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        full_name: row.full_name,
        role: row.role,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        details: row.details,
        created_at: row.created_at,
        cairo_time: row.cairo_time,
      }));

      for (const event of mappedEvents) {
        const bucket = byAgentMap.get(Number(event.user_id));
        if (!bucket) continue;
        bucket.count += 1;
        bucket.events.push(event);
      }

      const by_agent = [...byAgentMap.values()].sort(
        (a, b) => b.count - a.count || String(a.full_name || '').localeCompare(String(b.full_name || ''))
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
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
