const express = require('express');
const { query } = require('../config/db');
const { authStaff, requireRoles } = require('../middleware/auth');
const { emitSalesNotification } = require('../config/socket');
const { bookingAssigneeClause, isReservationsAgent } = require('../lib/reservationScope');

const router = express.Router();

router.use(authStaff, requireRoles('admin', 'reservations'));

router.get('/dashboard', async (req, res, next) => {
  try {
    const agentId = isReservationsAgent(req.user) ? req.user.id : null;
    const { rows: pending } = await query(
      `SELECT count(*)::int AS c FROM bookings
       WHERE status IN ('pending','held')
         AND ($1::int IS NULL OR assigned_sales_id = $1)`,
      [agentId]
    );
    const { rows: confirmed } = await query(
      `SELECT count(*)::int AS c FROM bookings
       WHERE status = 'confirmed'
         AND checkin >= CURRENT_DATE
         AND ($1::int IS NULL OR assigned_sales_id = $1)`,
      [agentId]
    );
    const scope = bookingAssigneeClause(req.user, '', 1);
    const { rows: recent } = await query(
      `SELECT * FROM bookings WHERE TRUE${scope.clause} ORDER BY created_at DESC LIMIT 10`,
      scope.params
    );
    res.json({
      pending: pending[0].c,
      upcomingConfirmed: confirmed[0].c,
      recent: recent,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/bookings', async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const params = [];
    let where = 'TRUE';
    if (status) {
      params.push(status);
      where = `status = $${params.length}`;
    }
    const scope = bookingAssigneeClause(req.user, '', params.length + 1);
    params.push(...scope.params);
    params.push(Number(limit), Number(offset));
    const { rows } = await query(
      `SELECT * FROM bookings WHERE ${where}${scope.clause} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/bookings/:id/status', async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const { rows } = await query(
      `UPDATE bookings SET status = $1, notes = COALESCE($2, notes) WHERE id = $3 RETURNING *`,
      [status, notes || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

router.get('/schedule', async (req, res, next) => {
  try {
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const toDate = new Date(from);
    toDate.setDate(toDate.getDate() + 30);
    const to = req.query.to || toDate.toISOString().slice(0, 10);
    const scope = bookingAssigneeClause(req.user, '', 3);
    const { rows } = await query(
      `SELECT id, listing_title, listing_slug, guest_name, checkin, checkout, status, total_egp
       FROM bookings
       WHERE checkin < $1 AND checkout > $2 AND status IN ('confirmed','pending','held')${scope.clause}
       ORDER BY checkin`,
      [to, from, ...scope.params]
    );
    res.json({ items: rows, from, to });
  } catch (err) {
    next(err);
  }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM sales_notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
});

router.patch('/notifications/read', async (req, res, next) => {
  try {
    await query(`UPDATE sales_notifications SET is_read = 1 WHERE user_id = $1`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/notify-test', async (req, res) => {
  emitSalesNotification(req.user.id, { title: 'Test', message: 'Socket ok' });
  res.json({ ok: true });
});

module.exports = router;
