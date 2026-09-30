const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { logAudit } = require('../../lib/audit');
const { DEFAULT_CHECKLIST } = require('../../jobs/housekeepingTasks');

const router = express.Router();

router.get(
  '/housekeeping-tasks',
  requireRoles('operations', 'operations_supervisor', 'admin'),
  async (req, res, next) => {
  try {
    const status = req.query.status;
    const params = [];
    let where = '1=1';
    if (status) {
      params.push(status);
      where += ` AND t.status = $${params.length}`;
    }
    if (req.query.unit_id) {
      params.push(req.query.unit_id);
      where += ` AND t.unit_id = $${params.length}`;
    }
    const { rows } = await query(
      `SELECT t.*,
              COALESCE(u.unit_number, u.title, 'Unit') AS unit_name,
              u.unit_number,
              u.id AS unit_uuid,
              COALESCE(u.project, u.compound) AS project,
              u.ops_status,
              r.check_in, r.check_out,
              r.guest_name AS guest_name_internal,
              COALESCE(r.guest_phone, b.guest_phone) AS guest_phone,
              COALESCE(t.source, 'pre_arrival') AS source,
              t.requested_time
       FROM housekeeping_tasks t
       JOIN units u ON u.id = t.unit_id
       LEFT JOIN reservations r ON r.id = t.reservation_id
       LEFT JOIN bookings b ON b.id = t.booking_id
       WHERE ${where}
       ORDER BY COALESCE(t.due_at, t.created_at) ASC
       LIMIT 200`,
      params
    );
    
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/housekeeping-tasks', requireRoles('admin', 'reservations', 'reservations_web'), async (req, res, next) => {
  try {
    const b = req.body;
    if (!b.unit_id) return res.status(400).json({ error: 'unit_id required' });
    const { rows } = await query(
      `INSERT INTO housekeeping_tasks (
         reservation_id, unit_id, assigned_to, status, checklist, due_at, notes
       ) VALUES ($1,$2,$3,COALESCE($4,'pending'),COALESCE($5::jsonb, $6::jsonb),$7,$8)
       RETURNING *`,
      [
        b.reservation_id || null,
        b.unit_id,
        b.assigned_to || null,
        b.status,
        b.checklist ? JSON.stringify(b.checklist) : null,
        JSON.stringify(DEFAULT_CHECKLIST),
        b.due_at || null,
        b.notes || null,
      ]
    );
    await logAudit({
      userId: req.user.id,
      action: 'CREATE_HOUSEKEEPING_TASK',
      entityType: 'housekeeping_task',
      entityId: rows[0].id,
      details: { unit_id: b.unit_id, reservation_id: b.reservation_id },
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch(
  '/housekeeping-tasks/:id',
  requireRoles('operations', 'operations_supervisor', 'admin'),
  async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await query(
      `UPDATE housekeeping_tasks SET
         status = COALESCE($1, status),
         assigned_to = COALESCE($2, assigned_to),
         checklist = COALESCE($3::jsonb, checklist),
         before_photo_urls = COALESCE($4::text[], before_photo_urls),
         after_photo_urls = COALESCE($5::text[], after_photo_urls),
         notes = COALESCE($6, notes),
         arrive_lat = COALESCE($7, arrive_lat),
         arrive_lng = COALESCE($8, arrive_lng),
         due_at = COALESCE($9::timestamptz, due_at),
         accepted_at = CASE WHEN $1 = 'accepted' THEN COALESCE(accepted_at, now()) ELSE accepted_at END,
         started_at = CASE WHEN $1 = 'in_progress' THEN COALESCE(started_at, now()) ELSE started_at END,
         updated_at = now()
       WHERE id = $10
       RETURNING *`,
      [
        b.status || null,
        b.assigned_to ?? null,
        b.checklist != null ? JSON.stringify(b.checklist) : null,
        Array.isArray(b.before_photo_urls) ? b.before_photo_urls : null,
        Array.isArray(b.after_photo_urls) ? b.after_photo_urls : null,
        b.notes ?? null,
        b.arrive_lat ?? null,
        b.arrive_lng ?? null,
        b.due_at || b.cleaning_date || null,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/housekeeping-tasks/:id/submit',
  requireRoles('operations', 'operations_supervisor', 'admin'),
  async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows } = await query(
      `UPDATE housekeeping_tasks SET
         status = 'submitted',
         after_photo_urls = COALESCE($1::text[], after_photo_urls),
         checklist = COALESCE($2::jsonb, checklist),
         submitted_at = now(),
         updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [
        Array.isArray(b.after_photo_urls) ? b.after_photo_urls : null,
        b.checklist != null ? JSON.stringify(b.checklist) : null,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await logAudit({
      userId: req.user.id,
      action: 'SUBMIT_HOUSEKEEPING_TASK',
      entityType: 'housekeeping_task',
      entityId: rows[0].id,
    });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.post('/housekeeping-tasks/:id/inspect', requireRoles('admin', 'reservations', 'reservations_web'), async (req, res, next) => {
  try {
    const result = String(req.body.result || '').toLowerCase();
    if (!['pass', 'fail'].includes(result)) {
      return res.status(400).json({ error: 'result must be pass or fail' });
    }
    const { rows: tasks } = await query(`SELECT * FROM housekeeping_tasks WHERE id = $1`, [
      req.params.id,
    ]);
    if (!tasks[0]) return res.status(404).json({ error: 'Not found' });

    await query(
      `INSERT INTO housekeeping_inspections (task_id, result, notes, inspector_id)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, result, req.body.notes || null, req.user.id]
    );

    const nextStatus = result === 'pass' ? 'ready' : 'needs_reclean';
    const { rows } = await query(
      `UPDATE housekeeping_tasks SET
         status = $1,
         ready_at = CASE WHEN $1 = 'ready' THEN now() ELSE ready_at END,
         updated_at = now()
       WHERE id = $2
       RETURNING *`,
      [nextStatus, req.params.id]
    );

    if (result === 'pass') {
      await query(
        `UPDATE units SET ops_status = 'available', updated_at = now() WHERE id = $1`,
        [tasks[0].unit_id]
      );
    } else {
      await query(
        `UPDATE units SET ops_status = 'maintenance', updated_at = now() WHERE id = $1`,
        [tasks[0].unit_id]
      );
    }

    await logAudit({
      userId: req.user.id,
      action: 'INSPECT_HOUSEKEEPING_TASK',
      entityType: 'housekeeping_task',
      entityId: rows[0].id,
      details: { result, nextStatus },
    });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});


router.get('/housekeeping-service-orders', requireRoles('admin', 'reservations', 'reservations_web'), async (req, res, next) => {
  try {
    const { FINANCIAL_EPOCH, clampFromDate } = require('../../lib/financialEpoch');
    const from = clampFromDate(req.query.from_date || FINANCIAL_EPOCH);
    const to = req.query.to_date || null;
    const params = [from];
    let where = `period_start >= $1::date`;
    if (to) {
      params.push(to);
      where += ` AND period_end <= $${params.length}::date`;
    }
    if (req.query.status) {
      params.push(req.query.status);
      where += ` AND status = $${params.length}`;
    } else if (req.query.include_cancelled !== '1') {
      where += ` AND status <> 'cancelled'`;
    }
    const { rows } = await query(
      `SELECT * FROM housekeeping_service_orders
       WHERE ${where}
       ORDER BY period_start DESC, created_at DESC
       LIMIT 300`,
      params
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post('/housekeeping-service-orders', requireRoles('admin', 'reservations', 'reservations_web'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const clientName = String(b.client_name || '').trim();
    const unitNumber = String(b.unit_number || '').trim();
    const amount = parseFloat(b.amount);
    const periodStart = b.period_start;
    const periodEnd = b.period_end || b.period_start;
    if (!clientName) return res.status(400).json({ error: 'client_name required' });
    if (!unitNumber) return res.status(400).json({ error: 'unit_number required' });
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'Valid amount required' });
    }
    if (!periodStart || !periodEnd) {
      return res.status(400).json({ error: 'period_start and period_end required' });
    }
    if (String(periodEnd) < String(periodStart)) {
      return res.status(400).json({ error: 'period_end must be on or after period_start' });
    }
    const { rows } = await query(
      `INSERT INTO housekeeping_service_orders (
         client_name, client_phone, unit_number, amount,
         period_start, period_end, status, notes, unit_id, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'requested'),$8,$9,$10)
       RETURNING *`,
      [
        clientName,
        b.client_phone || null,
        unitNumber,
        amount,
        periodStart,
        periodEnd,
        b.status || 'requested',
        b.notes || null,
        b.unit_id || null,
        req.user.id,
      ]
    );
    await logAudit({
      userId: req.user.id,
      action: 'CREATE_HK_SERVICE_ORDER',
      entityType: 'housekeeping_service_order',
      entityId: rows[0].id,
      details: { unit_number: unitNumber, amount },
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch('/housekeeping-service-orders/:id', requireRoles('admin', 'reservations', 'reservations_web'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const { rows } = await query(
      `UPDATE housekeeping_service_orders SET
         client_name = COALESCE($1, client_name),
         client_phone = COALESCE($2, client_phone),
         unit_number = COALESCE($3, unit_number),
         amount = COALESCE($4, amount),
         period_start = COALESCE($5, period_start),
         period_end = COALESCE($6, period_end),
         status = COALESCE($7, status),
         notes = COALESCE($8, notes),
         updated_at = now()
       WHERE id = $9
       RETURNING *`,
      [
        b.client_name ?? null,
        b.client_phone !== undefined ? b.client_phone : null,
        b.unit_number ?? null,
        b.amount != null ? parseFloat(b.amount) : null,
        b.period_start ?? null,
        b.period_end ?? null,
        b.status ?? null,
        b.notes !== undefined ? b.notes : null,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Service order not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
