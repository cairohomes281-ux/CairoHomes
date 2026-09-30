const { query } = require('../config/db');
const { salesLabelBelongsToUser, aliasLabelsForName } = require('./salesNameMatch');

const RESERVATIONS_TEAM_ROLES = new Set([
  'reservations',
  'reservations_web',
  'reservations_manual',
]);

/** Roles included in reservations manager daily audit (desk + manager). */
const RESERVATION_AUDIT_TEAM_ROLES = [
  'reservations',
  'reservations_web',
  'reservations_manual',
  'reservations_manager',
];

const RESERVATION_AUDIT_ACTIONS = [
  'CREATE_RESERVATION',
  'UPDATE_RESERVATION',
  'CANCEL_RESERVATION',
  'DELETE_RESERVATION',
  'TRANSFER_RESERVATION',
  'UPLOAD_RESERVATION_ID',
  'REMOVE_RESERVATION_ID',
  'RECORD_PAYMENT',
  'APPROVE_PAYMENT',
  'ACCEPT_WEBSITE_BOOKING',
  'REJECT_WEBSITE_BOOKING',
  'ASSIGN_WEBSITE_BOOKING',
  'UPDATE_WEBSITE_COLLECTED',
];

function isReservationsTeam(user) {
  return RESERVATIONS_TEAM_ROLES.has(user?.role);
}


function isReservationsAgent(user) {
  return isReservationsTeam(user);
}

function isReservationsManager(user) {
  return user?.role === 'reservations_manager';
}

function isWebsiteReservationsAgent(user) {
  return user?.role === 'reservations_web' || user?.role === 'reservations';
}

function isManualReservationsAgent(user) {
  return user?.role === 'reservations_manual' || user?.role === 'reservations';
}

function isAdmin(user) {
  return user?.role === 'admin';
}

/** Roles that may list/view all reservations (not scoped to own sales). */
const BROAD_RESERVATION_ACCESS_ROLES = new Set(['admin', 'owners_relations']);

/** Finance sees every website-origin reservation (not manual/OTA-only). */
const WEBSITE_ALL_RESERVATION_ROLES = new Set(['finance', 'finance_manager']);

/** Managers who see own + direct-report team reservations. */
const TEAM_RESERVATION_ROLES = new Set([
  'reservations_manager',
  'hr_supervisor',
  'unit_acquisition_manager',
  'operations_supervisor',
]);

/** Staff who only see reservations they own / created / labeled as themselves. */
const OWN_ONLY_RESERVATION_ROLES = new Set([
  'reservations',
  'reservations_web',
  'reservations_manual',
  'hr',
  'marketing_pr',
  'unit_acquisition_agent',
  'operations',
]);

function hasBroadReservationAccess(user) {
  return BROAD_RESERVATION_ACCESS_ROLES.has(user?.role);
}

function hasWebsiteAllReservationAccess(user) {
  return WEBSITE_ALL_RESERVATION_ROLES.has(user?.role);
}

function hasTeamReservationAccess(user) {
  return TEAM_RESERVATION_ROLES.has(user?.role);
}

function hasOwnOnlyReservationAccess(user) {
  return OWN_ONLY_RESERVATION_ROLES.has(user?.role) || isReservationsTeam(user);
}

function isWebsiteOriginReservation(reservation) {
  if (!reservation) return false;
  if (reservation.booking_id) return true;
  const src = String(reservation.booking_source || '').trim().toLowerCase();
  return src === 'website' || src === 'web';
}

function assertNotAdminReservationHandler(user, action = 'manage reservations') {
  if (isAdmin(user)) {
    const err = new Error(`Admins cannot ${action}`);
    err.status = 403;
    throw err;
  }
}


async function pickLeastLoadedReservationsAgent() {
  const { rows } = await query(
    `SELECT s.id
     FROM staff_users s
     LEFT JOIN (
       SELECT staff_id, COUNT(*)::int AS cnt
       FROM (
         SELECT sales_person_id AS staff_id
         FROM reservations
         WHERE status NOT IN ('cancelled')
           AND sales_person_id IS NOT NULL
         UNION ALL
         SELECT assigned_sales_id AS staff_id
         FROM bookings
         WHERE status IN ('pending', 'held')
           AND assigned_sales_id IS NOT NULL
       ) workload
       GROUP BY staff_id
     ) load ON load.staff_id = s.id
     WHERE s.is_active = 1
       AND s.role IN ('reservations_web', 'reservations')
     ORDER BY COALESCE(load.cnt, 0) ASC, random()
     LIMIT 1`
  );
  if (rows[0]?.id) return rows[0].id;

  
  const { rows: admins } = await query(
    `SELECT id FROM staff_users
     WHERE is_active = 1 AND role = 'admin'
     ORDER BY id
     LIMIT 1`
  );
  return admins[0]?.id ?? null;
}


function reservationScopeClause(user, alias = 'r', paramIndex = 1) {
  if (hasBroadReservationAccess(user) || isAdmin(user)) {
    return { clause: '', params: [], nextIndex: paramIndex };
  }

  if (hasWebsiteAllReservationAccess(user)) {
    return {
      clause: ` AND (
        ${alias}.booking_id IS NOT NULL
        OR lower(trim(COALESCE(${alias}.booking_source, ''))) IN ('website', 'web')
      )`,
      params: [],
      nextIndex: paramIndex,
    };
  }

  if (user.role === 'operations_supervisor') {
    return {
      clause: ` AND (
        ${alias}.ops_assigned_to = $${paramIndex}
        OR ${alias}.ops_assigned_to IN (
          SELECT id FROM staff_users
          WHERE manager_id = $${paramIndex} AND role = 'operations'
        )
        OR ${alias}.created_by = $${paramIndex}
        OR ${alias}.ops_assigned_by = $${paramIndex}
      )`,
      params: [user.id],
      nextIndex: paramIndex + 1,
    };
  }

  if (user.role === 'operations') {
    return {
      clause: ` AND ${alias}.ops_assigned_to = $${paramIndex}`,
      params: [user.id],
      nextIndex: paramIndex + 1,
    };
  }

  if (hasTeamReservationAccess(user) || isReservationsManager(user)) {
    return {
      clause: ` AND (
        ${alias}.sales_person_id = $${paramIndex}
        OR ${alias}.created_by = $${paramIndex}
        OR ${alias}.sales_person_id IN (SELECT id FROM staff_users WHERE manager_id = $${paramIndex})
        OR ${alias}.created_by IN (SELECT id FROM staff_users WHERE manager_id = $${paramIndex})
        OR EXISTS (
          SELECT 1 FROM staff_users s
          WHERE s.manager_id = $${paramIndex}
            AND s.role IN ('reservations', 'reservations_web', 'reservations_manual', 'hr', 'unit_acquisition_agent')
            AND ${alias}.sales_label IS NOT NULL
            AND btrim(${alias}.sales_label) <> ''
            AND lower(regexp_replace(btrim(${alias}.sales_label), '\\s+', ' ', 'g'))
              = lower(regexp_replace(btrim(s.full_name), '\\s+', ' ', 'g'))
        )
      )`,
      params: [user.id],
      nextIndex: paramIndex + 1,
    };
  }

  if (!hasOwnOnlyReservationAccess(user)) {
    return { clause: ' AND 1=0', params: [], nextIndex: paramIndex };
  }

  const name = String(user.full_name || '').trim();
  const params = [user.id];
  let nextIndex = paramIndex + 1;

  let clause = ` AND (
    ${alias}.sales_person_id = $${paramIndex}
    OR ${alias}.created_by = $${paramIndex}`;

  if (name) {
    const nameParam = nextIndex;
    params.push(name);
    nextIndex += 1;

    const aliases = aliasLabelsForName(name).filter(Boolean);
    let aliasSql = '';
    if (aliases.length) {
      const aliasParam = nextIndex;
      params.push(aliases);
      nextIndex += 1;
      aliasSql = `
        OR lower(regexp_replace(btrim(${alias}.sales_label), '\\s+', ' ', 'g'))
          = ANY($${aliasParam}::text[])`;
    }

    clause += `
    OR (
      ${alias}.sales_label IS NOT NULL
      AND btrim(${alias}.sales_label) <> ''
      AND lower(btrim(${alias}.sales_label)) NOT IN ('owner')
      AND (
        lower(regexp_replace(btrim(${alias}.sales_label), '\\s+', ' ', 'g'))
          = lower(regexp_replace(btrim($${nameParam}), '\\s+', ' ', 'g'))
        ${aliasSql}
        OR (
          array_length(
            regexp_split_to_array(lower(regexp_replace(btrim($${nameParam}), '\\s+', ' ', 'g')), '\\s+'),
            1
          ) >= 2
          AND lower(regexp_replace(btrim(${alias}.sales_label), '\\s+', ' ', 'g'))
            LIKE lower(regexp_replace(btrim($${nameParam}), '\\s+', ' ', 'g')) || ' %'
        )
        OR (
          array_length(
            regexp_split_to_array(
              lower(regexp_replace(btrim(${alias}.sales_label), '\\s+', ' ', 'g')),
              '\\s+'
            ),
            1
          ) >= 2
          AND lower(regexp_replace(btrim($${nameParam}), '\\s+', ' ', 'g'))
            LIKE lower(regexp_replace(btrim(${alias}.sales_label), '\\s+', ' ', 'g')) || ' %'
        )
      )
    )`;
  }

  clause += `
  )`;

  if (user.role === 'reservations_manual') {
    clause += ` AND ${alias}.booking_id IS NULL AND LOWER(trim(COALESCE(${alias}.booking_source, ''))) NOT IN ('website', 'web')`;
  }

  return { clause, params, nextIndex };
}


function bookingAssigneeClause(user, alias = 'b', paramIndex = 1) {
  if (user?.role === 'reservations_manual') {
    return { clause: ' AND FALSE', params: [], nextIndex: paramIndex };
  }
  if (isReservationsManager(user)) {
    const col = alias ? `${alias}.assigned_sales_id` : 'assigned_sales_id';
    return {
      clause: ` AND (
        ${col} = $${paramIndex}
        OR ${col} IN (SELECT id FROM staff_users WHERE manager_id = $${paramIndex})
      )`,
      params: [user.id],
      nextIndex: paramIndex + 1,
    };
  }
  if (isAdmin(user) || !isWebsiteReservationsAgent(user)) {
    return { clause: '', params: [], nextIndex: paramIndex };
  }
  const col = alias ? `${alias}.assigned_sales_id` : 'assigned_sales_id';
  return {
    clause: ` AND ${col} = $${paramIndex}`,
    params: [user.id],
    nextIndex: paramIndex + 1,
  };
}

async function loadReservationAccess(id) {
  const { rows } = await query(
    `SELECT id, unit_id, sales_person_id, created_by, booking_id, booking_source, status, sales_label
     FROM reservations WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function loadBookingAccess(id) {
  const { rows } = await query(
    `SELECT id, assigned_sales_id, status FROM bookings WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

function isOwnReservation(user, reservation) {
  return Boolean(
    reservation &&
      (Number(reservation.sales_person_id) === Number(user.id) ||
        Number(reservation.created_by) === Number(user.id) ||
        salesLabelBelongsToUser(reservation.sales_label, user))
  );
}

async function assertReservationOwned(user, reservation) {
  if (hasBroadReservationAccess(user) || isAdmin(user)) return;
  if (hasWebsiteAllReservationAccess(user)) {
    if (isWebsiteOriginReservation(reservation)) return;
    const err = new Error('Finance can only access website reservations');
    err.status = 403;
    throw err;
  }
  if (hasTeamReservationAccess(user) || isReservationsManager(user)) {
    if (isOwnReservation(user, reservation)) return;
    const ids = [reservation?.sales_person_id, reservation?.created_by]
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length) {
      const { rows } = await query(
        `SELECT 1 FROM staff_users WHERE manager_id = $1 AND id = ANY($2::int[]) LIMIT 1`,
        [user.id, ids]
      );
      if (rows[0]) return;
    }
    const err = new Error('You can only access reservations for yourself and your team');
    err.status = 403;
    throw err;
  }
  if (!hasOwnOnlyReservationAccess(user)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  if (!isOwnReservation(user, reservation)) {
    const err = new Error('You can only access your own reservations');
    err.status = 403;
    throw err;
  }
  if (user.role === 'reservations_manual' && isWebsiteOriginReservation(reservation)) {
    const err = new Error('Manual agents can only access manual reservations');
    err.status = 403;
    throw err;
  }
}

async function assertAssignableSalesPerson(user, salesPersonId) {
  if (isAdmin(user) || salesPersonId == null || salesPersonId === '') return;
  const id = Number(salesPersonId);
  if (!Number.isFinite(id) || id < 1) return;
  if (Number(user.id) === id) return;
  const err = new Error('You can only assign reservations to yourself');
  err.status = 403;
  throw err;
}

function assertBookingAssigned(user, booking) {
  if (isAdmin(user)) return;
  if (!isWebsiteReservationsAgent(user)) {
    const err = new Error('Only website reservation agents can manage website bookings');
    err.status = 403;
    throw err;
  }
  if (!booking) {
    const err = new Error('Booking not found');
    err.status = 404;
    throw err;
  }
}

module.exports = {
  RESERVATIONS_TEAM_ROLES,
  RESERVATION_AUDIT_TEAM_ROLES,
  RESERVATION_AUDIT_ACTIONS,
  isReservationsTeam,
  isReservationsAgent,
  isReservationsManager,
  isWebsiteReservationsAgent,
  isManualReservationsAgent,
  isAdmin,
  hasBroadReservationAccess,
  hasWebsiteAllReservationAccess,
  hasTeamReservationAccess,
  hasOwnOnlyReservationAccess,
  isWebsiteOriginReservation,
  pickLeastLoadedReservationsAgent,
  reservationScopeClause,
  bookingAssigneeClause,
  loadReservationAccess,
  loadBookingAccess,
  assertReservationOwned,
  assertAssignableSalesPerson,
  assertBookingAssigned,
  assertNotAdminReservationHandler,
};
