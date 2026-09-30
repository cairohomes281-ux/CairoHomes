let io = null;

const NOTIF_ROLES = new Set([
  'reservations',
  'reservations_web',
  'reservations_manual',
  'reservations_manager',
  'admin',
  'finance',
  'finance_manager',
  'sales',
  'Sales',
]);

function initSocket(server) {
  const { Server } = require('socket.io');
  const jwt = require('jsonwebtoken');
  const { query } = require('./db');
  const { tokenVersionMatches } = require('../lib/staffAuthSessions');
  const origins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  io = new Server(server, {
    cors: {
      origin: origins.includes('*') ? true : origins,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (String(socket.handshake.headers?.authorization || '').startsWith('Bearer ')
          ? String(socket.handshake.headers.authorization).slice(7)
          : null) ||
        socket.handshake.query?.token;
      if (!token || !process.env.JWT_SECRET) {
        return next(new Error('Unauthorized'));
      }
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.kind && payload.kind !== 'staff' && payload.kind !== 'sales') {
        return next(new Error('Unauthorized'));
      }
      const staffId = payload.sub || payload.id;
      if (!staffId) return next(new Error('Unauthorized'));

      const { rows } = await query(
        `SELECT id, role, is_active, COALESCE(auth_token_version, 0)::int AS auth_token_version
         FROM staff_users WHERE id = $1`,
        [staffId]
      );
      if (!rows[0] || !rows[0].is_active || !tokenVersionMatches(payload, rows[0])) {
        return next(new Error('Unauthorized'));
      }

      socket.staff = {
        id: rows[0].id,
        role: rows[0].role || payload.role,
      };
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.staff?.id;
    const role = socket.staff?.role;
    if (userId && NOTIF_ROLES.has(role)) {
      socket.join(`sales-user:${userId}`);
    }
  });

  return io;
}

function getIo() {
  return io;
}

function emitSalesNotification(userId, payload) {
  if (!io || !userId) return;
  const room = `sales-user:${userId}`;
  io.to(room).emit('sales:notification', payload);
  io.to(room).emit('pms:notification', payload);
  io.to(room).emit('NEW_NOTIFICATION', payload);
}

module.exports = { initSocket, getIo, emitSalesNotification };
