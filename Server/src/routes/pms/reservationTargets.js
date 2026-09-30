const express = require('express');
const { query, pool } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { isReservationsManager, isAdmin } = require('../../lib/reservationScope');
const { roundMoney } = require('../../lib/hrRules');
const { logAudit } = require('../../lib/audit');

const router = express.Router();

/** Agents who receive monthly booking targets (not the manager role itself). */
const TARGET_AGENT_ROLES = ['reservations', 'reservations_web', 'reservations_manual'];

const ACTIVE_STAY_SQL = `
  r.status <> 'cancelled'
  AND NOT (
    COALESCE(r.is_owner_reservation, 0)::int = 1
    AND COALESCE(r.total_amount, 0) = 0
  )
`;
const CAIRO_CREATED_DATE = `(r.created_at AT TIME ZONE 'Africa/Cairo')::date`;

function isoDate(d) {
  return String(d || '').slice(0, 10);
}

function parsePeriod(req) {
  const now = new Date();
  const year = Number(req.query.year || req.body?.year) || now.getFullYear();
  const month = Number(req.query.month || req.body?.month) || now.getMonth() + 1;
  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    const err = new Error('Invalid year');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    const err = new Error('Invalid month');
    err.status = 400;
    throw err;
  }
  return { year, month };
}

function monthBounds(year, month) {
  const mm = String(month).padStart(2, '0');
  const from = `${year}-${mm}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
  return { from, to };
}

function canManageTargets(user) {
  return isAdmin(user) || isReservationsManager(user);
}

async function loadTargetTeam() {
  const { rows } = await query(
    `SELECT id, full_name, role, staff_code
     FROM staff_users
     WHERE is_active = 1 AND role = ANY($1::text[])
     ORDER BY full_name`,
    [TARGET_AGENT_ROLES]
  );
  return rows;
}

async function bookingCountsForPeriod(staffIds, year, month) {
  if (!staffIds.length) return new Map();
  const { from, to } = monthBounds(year, month);
  const { rows } = await query(
    `SELECT COALESCE(r.sales_person_id, r.created_by) AS staff_id, COUNT(*)::int AS cnt
     FROM reservations r
     WHERE ${ACTIVE_STAY_SQL}
       AND ${CAIRO_CREATED_DATE} BETWEEN $1::date AND $2::date
       AND COALESCE(r.sales_person_id, r.created_by) = ANY($3::int[])
     GROUP BY 1`,
    [from, to, staffIds]
  );
  return new Map(rows.map((r) => [Number(r.staff_id), Number(r.cnt) || 0]));
}

router.get(
  '/reservation-targets',
  requireRoles('admin', 'reservations_manager'),
  async (req, res, next) => {
    try {
      if (!canManageTargets(req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const { year, month } = parsePeriod(req);
      const { from, to } = monthBounds(year, month);
      const team = await loadTargetTeam();
      const staffIds = team.map((t) => t.id);
      const counts = await bookingCountsForPeriod(staffIds, year, month);

      const { rows: targets } = await query(
        `SELECT t.*,
                b.amount AS applied_bonus_amount,
                d.amount AS applied_deduction_amount
         FROM staff_reservation_targets t
         LEFT JOIN staff_salary_bonuses b ON b.id = t.applied_bonus_id
         LEFT JOIN staff_salary_deductions d ON d.id = t.applied_deduction_id
         WHERE t.period_year = $1 AND t.period_month = $2
           AND t.staff_user_id = ANY($3::int[])`,
        [year, month, staffIds.length ? staffIds : [0]]
      );
      const byStaff = new Map(targets.map((t) => [Number(t.staff_user_id), t]));

      const rows = team.map((member) => {
        const target = byStaff.get(Number(member.id));
        const bookings = counts.get(Number(member.id)) || 0;
        const targetBookings = target ? Number(target.target_bookings) : null;
        const hit =
          targetBookings == null ? null : bookings >= targetBookings;
        return {
          staff_user_id: member.id,
          full_name: member.full_name,
          role: member.role,
          staff_code: member.staff_code,
          period_year: year,
          period_month: month,
          target_id: target?.id || null,
          target_bookings: targetBookings,
          bonus_amount: target ? Number(target.bonus_amount) || 0 : null,
          deduction_amount: target ? Number(target.deduction_amount) || 0 : null,
          status: target?.status || 'unset',
          bookings_count: bookings,
          hit,
          progress_pct:
            targetBookings > 0
              ? Math.min(100, Math.round((bookings / targetBookings) * 100))
              : targetBookings === 0
                ? 100
                : 0,
          applied_at: target?.applied_at || null,
          applied_bonus_id: target?.applied_bonus_id || null,
          applied_deduction_id: target?.applied_deduction_id || null,
        };
      });

      res.json({
        year,
        month,
        from_date: from,
        to_date: to,
        rows,
        totals: {
          agents: rows.length,
          with_target: rows.filter((r) => r.target_bookings != null).length,
          hitting: rows.filter((r) => r.hit === true).length,
          missing: rows.filter((r) => r.hit === false).length,
          applied: rows.filter((r) => r.status === 'applied').length,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

router.put(
  '/reservation-targets',
  requireRoles('admin', 'reservations_manager'),
  async (req, res, next) => {
    try {
      if (!canManageTargets(req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const { year, month } = parsePeriod(req);
      const staffUserId = Number(req.body?.staff_user_id);
      const targetBookings = Number(req.body?.target_bookings);
      const bonusAmount = roundMoney(Number(req.body?.bonus_amount) || 0);
      const deductionAmount = roundMoney(Number(req.body?.deduction_amount) || 0);

      if (!Number.isFinite(staffUserId) || staffUserId < 1) {
        return res.status(400).json({ error: 'Choose an agent' });
      }
      if (!Number.isFinite(targetBookings) || targetBookings < 0 || !Number.isInteger(targetBookings)) {
        return res.status(400).json({ error: 'Target bookings must be a whole number ≥ 0' });
      }
      if (bonusAmount < 0 || deductionAmount < 0) {
        return res.status(400).json({ error: 'Bonus and deduction amounts cannot be negative' });
      }
      if (bonusAmount === 0 && deductionAmount === 0) {
        return res.status(400).json({ error: 'Set a bonus amount and/or a deduction amount' });
      }

      const { rows: staffRows } = await query(
        `SELECT id, full_name, role FROM staff_users WHERE id = $1 AND is_active = 1`,
        [staffUserId]
      );
      const staff = staffRows[0];
      if (!staff || !TARGET_AGENT_ROLES.includes(staff.role)) {
        return res.status(400).json({ error: 'Targets are only for reservation agents' });
      }

      const { rows: existing } = await query(
        `SELECT id, status FROM staff_reservation_targets
         WHERE staff_user_id = $1 AND period_year = $2 AND period_month = $3`,
        [staffUserId, year, month]
      );
      if (existing[0]?.status === 'applied') {
        return res.status(400).json({
          error: 'This month already has bonus/deduction applied. Re-apply after editing is blocked — ask HR to adjust payslip rows if needed.',
        });
      }

      const { rows } = await query(
        `INSERT INTO staff_reservation_targets
           (staff_user_id, period_year, period_month, target_bookings, bonus_amount, deduction_amount, created_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())
         ON CONFLICT (staff_user_id, period_year, period_month)
         DO UPDATE SET
           target_bookings = EXCLUDED.target_bookings,
           bonus_amount = EXCLUDED.bonus_amount,
           deduction_amount = EXCLUDED.deduction_amount,
           updated_at = now()
         WHERE staff_reservation_targets.status = 'open'
         RETURNING *`,
        [staffUserId, year, month, targetBookings, bonusAmount, deductionAmount, req.user.id]
      );

      await logAudit({
        userId: req.user.id,
        action: 'UPSERT_RESERVATION_TARGET',
        entityType: 'staff_reservation_target',
        entityId: rows[0]?.id,
        details: { staff_user_id: staffUserId, year, month, target_bookings: targetBookings },
      });

      res.json(rows[0]);
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/reservation-targets/bulk',
  requireRoles('admin', 'reservations_manager'),
  async (req, res, next) => {
    try {
      if (!canManageTargets(req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const { year, month } = parsePeriod(req);
      const targetBookings = Number(req.body?.target_bookings);
      const bonusAmount = roundMoney(Number(req.body?.bonus_amount) || 0);
      const deductionAmount = roundMoney(Number(req.body?.deduction_amount) || 0);
      const staffIds = Array.isArray(req.body?.staff_user_ids)
        ? req.body.staff_user_ids.map(Number).filter((id) => Number.isFinite(id) && id > 0)
        : null;

      if (!Number.isFinite(targetBookings) || targetBookings < 0 || !Number.isInteger(targetBookings)) {
        return res.status(400).json({ error: 'Target bookings must be a whole number ≥ 0' });
      }
      if (bonusAmount === 0 && deductionAmount === 0) {
        return res.status(400).json({ error: 'Set a bonus amount and/or a deduction amount' });
      }

      const team = await loadTargetTeam();
      const targets = staffIds?.length
        ? team.filter((t) => staffIds.includes(Number(t.id)))
        : team;
      if (!targets.length) {
        return res.status(400).json({ error: 'No reservation agents to update' });
      }

      let updated = 0;
      let skipped = 0;
      for (const member of targets) {
        const { rows: existing } = await query(
          `SELECT status FROM staff_reservation_targets
           WHERE staff_user_id = $1 AND period_year = $2 AND period_month = $3`,
          [member.id, year, month]
        );
        if (existing[0]?.status === 'applied') {
          skipped += 1;
          continue;
        }
        await query(
          `INSERT INTO staff_reservation_targets
             (staff_user_id, period_year, period_month, target_bookings, bonus_amount, deduction_amount, created_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7, now())
           ON CONFLICT (staff_user_id, period_year, period_month)
           DO UPDATE SET
             target_bookings = EXCLUDED.target_bookings,
             bonus_amount = EXCLUDED.bonus_amount,
             deduction_amount = EXCLUDED.deduction_amount,
             updated_at = now()
           WHERE staff_reservation_targets.status = 'open'`,
          [member.id, year, month, targetBookings, bonusAmount, deductionAmount, req.user.id]
        );
        updated += 1;
      }

      res.json({ ok: true, updated, skipped, year, month });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/reservation-targets/apply',
  requireRoles('admin', 'reservations_manager'),
  async (req, res, next) => {
    try {
      if (!canManageTargets(req.user)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const { year, month } = parsePeriod(req);
      const { to } = monthBounds(year, month);
      const onlyIds = Array.isArray(req.body?.staff_user_ids)
        ? req.body.staff_user_ids.map(Number).filter((id) => Number.isFinite(id) && id > 0)
        : null;

      const { rows: openTargets } = await query(
        `SELECT t.*, u.full_name, u.role
         FROM staff_reservation_targets t
         JOIN staff_users u ON u.id = t.staff_user_id
         WHERE t.period_year = $1 AND t.period_month = $2
           AND t.status = 'open'
           AND u.role = ANY($3::text[])
           ${onlyIds?.length ? 'AND t.staff_user_id = ANY($4::int[])' : ''}`,
        onlyIds?.length
          ? [year, month, TARGET_AGENT_ROLES, onlyIds]
          : [year, month, TARGET_AGENT_ROLES]
      );

      if (!openTargets.length) {
        return res.status(400).json({ error: 'No open targets to apply for this month' });
      }

      const staffIds = openTargets.map((t) => t.staff_user_id);
      const counts = await bookingCountsForPeriod(staffIds, year, month);
      const periodLabel = `${year}-${String(month).padStart(2, '0')}`;
      const results = [];

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const target of openTargets) {
          const bookings = counts.get(Number(target.staff_user_id)) || 0;
          const needed = Number(target.target_bookings) || 0;
          const hit = bookings >= needed;
          const bonusAmount = roundMoney(Number(target.bonus_amount) || 0);
          const deductionAmount = roundMoney(Number(target.deduction_amount) || 0);
          let bonusId = null;
          let deductionId = null;

          if (hit && bonusAmount > 0) {
            const { rows: bonusRows } = await client.query(
              `INSERT INTO staff_salary_bonuses (staff_user_id, amount, reason, bonus_date, created_by)
               VALUES ($1,$2,$3,$4::date,$5)
               RETURNING id`,
              [
                target.staff_user_id,
                bonusAmount,
                `Reservation target met ${periodLabel} (${bookings}/${needed})`.slice(0, 255),
                to,
                req.user.id,
              ]
            );
            bonusId = bonusRows[0].id;
          } else if (!hit && deductionAmount > 0) {
            const { rows: dedRows } = await client.query(
              `INSERT INTO staff_salary_deductions
                 (staff_user_id, amount, reason, deduction_date, category, created_by,
                  arrival_time, notified, daily_rate, days_factor)
               VALUES ($1,$2,$3,$4::date,'performance',$5,NULL,NULL,NULL,NULL)
               RETURNING id`,
              [
                target.staff_user_id,
                deductionAmount,
                `Reservation target missed ${periodLabel} (${bookings}/${needed})`.slice(0, 255),
                to,
                req.user.id,
              ]
            );
            deductionId = dedRows[0].id;
          }

          await client.query(
            `UPDATE staff_reservation_targets SET
               status = 'applied',
               bookings_count = $2,
               applied_bonus_id = $3,
               applied_deduction_id = $4,
               applied_at = now(),
               applied_by = $5,
               updated_at = now()
             WHERE id = $1`,
            [target.id, bookings, bonusId, deductionId, req.user.id]
          );

          results.push({
            staff_user_id: target.staff_user_id,
            full_name: target.full_name,
            bookings,
            target_bookings: needed,
            hit,
            bonus_id: bonusId,
            deduction_id: deductionId,
            outcome: hit
              ? bonusId
                ? 'bonus'
                : 'met_no_bonus'
              : deductionId
                ? 'deduction'
                : 'missed_no_deduction',
          });
        }
        await client.query('COMMIT');
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw err;
      } finally {
        client.release();
      }

      await logAudit({
        userId: req.user.id,
        action: 'APPLY_RESERVATION_TARGETS',
        entityType: 'staff_reservation_target',
        entityId: null,
        details: { year, month, count: results.length },
      });

      res.json({
        ok: true,
        year,
        month,
        applied_date: to,
        results,
        summary: {
          applied: results.length,
          bonuses: results.filter((r) => r.bonus_id).length,
          deductions: results.filter((r) => r.deduction_id).length,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
