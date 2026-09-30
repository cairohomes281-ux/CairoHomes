const { query } = require('../config/db');
const { emitSalesNotification } = require('../config/socket');


const WEB_TEAM_ROLES = ['admin', 'reservations_web', 'reservations'];

const OPS_ROLES = ['admin', 'reservations_web', 'reservations_manual', 'reservations', 'reservations_manager'];
const ADMIN_ROLES = ['admin'];
const FINANCE_ROLES = ['admin', 'finance', 'finance_manager'];

async function resolveUserIds({ roles, userIds, excludeUserIds = [] } = {}) {
  const exclude = new Set(
    (excludeUserIds || [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  );
  const ids = new Set();

  for (const raw of userIds || []) {
    const id = Number(raw);
    if (Number.isFinite(id) && id > 0 && !exclude.has(id)) ids.add(id);
  }

  if (roles?.length) {
    const { rows } = await query(
      `SELECT id FROM staff_users
       WHERE is_active = 1 AND role = ANY($1::text[])`,
      [roles]
    );
    for (const row of rows) {
      const id = Number(row.id);
      if (!exclude.has(id)) ids.add(id);
    }
  }

  return [...ids];
}


async function notifyStaff({
  roles,
  userIds,
  excludeUserIds,
  type,
  title,
  message,
  entity_type = null,
  entity_id = null,
  dedupeSameDay = false,
} = {}) {
  if (!type || !title || !message) return [];

  const ids = await resolveUserIds({ roles, userIds, excludeUserIds });
  if (!ids.length) return [];

  const created = [];
  for (const userId of ids) {
    if (dedupeSameDay && entity_type && entity_id != null) {
      const { rows: existing } = await query(
        `SELECT id FROM notifications
         WHERE user_id = $1
           AND type = $2
           AND entity_type = $3
           AND entity_id = $4
           AND created_at::date = CURRENT_DATE
         LIMIT 1`,
        [userId, type, entity_type, entity_id]
      );
      if (existing[0]) continue;
    }

    const { rows } = await query(
      `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, type, title, message, entity_type, entity_id]
    );
    const row = rows[0];
    if (!row) continue;

    emitSalesNotification(userId, {
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      created_at: row.created_at,
    });
    created.push(row);
  }

  return created;
}

async function notifyNewWebsiteBooking(booking, { assigneeId } = {}) {
  if (!booking?.id) return [];
  const guest = booking.guest_name || 'Guest';
  const unit = booking.listing_title || booking.unit_title || booking.unit_number || 'unit';
  const guests = booking.guests != null ? `${booking.guests} guests` : null;
  const total =
    booking.total_egp != null
      ? `EGP ${Number(booking.total_egp).toLocaleString('en-EG')}`
      : null;
  const bits = [guest, unit, guests, total].filter(Boolean);

  return notifyStaff({
    roles: WEB_TEAM_ROLES,
    userIds: assigneeId ? [assigneeId] : [],
    type: 'new_booking',
    title: 'New website reservation request',
    message: bits.join(' · '),
    entity_type: 'booking',
    entity_id: booking.id,
  });
}

async function notifyWebsiteBookingAccepted(booking, actor) {
  if (!booking?.id) return [];
  const guest = booking.guest_name || 'Guest';
  const actorName = actor?.full_name || actor?.username || 'Staff';
  return notifyStaff({
    roles: ADMIN_ROLES,
    userIds: booking.assigned_sales_id ? [booking.assigned_sales_id] : [],
    excludeUserIds: [actor?.id],
    type: 'booking_accepted',
    title: 'Website booking accepted',
    message: `${guest} accepted by ${actorName}`,
    entity_type: 'booking',
    entity_id: booking.id,
  });
}

async function notifyWebsiteBookingRejected(booking, actor, reason) {
  if (!booking?.id) return [];
  const guest = booking.guest_name || 'Guest';
  const actorName = actor?.full_name || actor?.username || 'Staff';
  const reasonText = reason ? ` — ${String(reason).slice(0, 120)}` : '';
  return notifyStaff({
    roles: ADMIN_ROLES,
    userIds: booking.assigned_sales_id ? [booking.assigned_sales_id] : [],
    excludeUserIds: [actor?.id],
    type: 'booking_rejected',
    title: 'Website booking rejected',
    message: `${guest} rejected by ${actorName}${reasonText}`,
    entity_type: 'booking',
    entity_id: booking.id,
  });
}

async function notifyManualReservationCreated(reservation, actor) {
  if (!reservation?.id) return [];
  if (reservation.is_owner_reservation && !(Number(reservation.total_amount) > 0)) {
    return []; 
  }
  const guest = reservation.guest_name || 'Guest';
  const actorName = actor?.full_name || actor?.username || 'Staff';
  return notifyStaff({
    roles: ADMIN_ROLES,
    excludeUserIds: [actor?.id],
    type: 'reservation_created',
    title: 'New manual reservation',
    message: `${guest} created by ${actorName}`,
    entity_type: 'reservation',
    entity_id: reservation.id,
  });
}

async function notifyCancelRequest(reservation, actor, reason) {
  if (!reservation?.id) return [];
  const guest = reservation.guest_name || 'Guest';
  const actorName = actor?.full_name || actor?.username || 'Staff';
  const reasonText = reason ? ` — ${String(reason).slice(0, 120)}` : '';
  return notifyStaff({
    roles: FINANCE_ROLES,
    excludeUserIds: [actor?.id],
    type: 'cancel_request',
    title: 'Cancellation request',
    message: `${guest} — requested by ${actorName}${reasonText}`,
    entity_type: 'reservation',
    entity_id: reservation.id,
  });
}

async function notifyPaymentRecorded(payment, reservation, actor) {
  if (!payment?.id || !reservation?.id) return [];
  
  if (['admin', 'finance', 'finance_manager'].includes(actor?.role)) return [];
  const amount = Number(payment.amount) || 0;
  const guest = reservation.guest_name || 'Guest';
  const actorName = actor?.full_name || actor?.username || 'Staff';
  return notifyStaff({
    roles: FINANCE_ROLES,
    excludeUserIds: [actor?.id],
    type: 'payment_pending',
    title: 'Payment awaiting approval',
    message: `${guest} · EGP ${amount.toLocaleString('en-EG')} by ${actorName}`,
    entity_type: 'reservation',
    entity_id: reservation.id,
  });
}

module.exports = {
  notifyStaff,
  notifyNewWebsiteBooking,
  notifyWebsiteBookingAccepted,
  notifyWebsiteBookingRejected,
  notifyManualReservationCreated,
  notifyCancelRequest,
  notifyPaymentRecorded,
  WEB_TEAM_ROLES,
  OPS_ROLES,
  ADMIN_ROLES,
  FINANCE_ROLES,
};
