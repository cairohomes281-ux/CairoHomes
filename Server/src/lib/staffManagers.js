const { query } = require('../config/db');

const MULTI_MANAGER_ROLES = new Set(['web_developer']);

const LINE_MANAGER_ROLES = [
  'admin',
  'hr_supervisor',
  'reservations_manager',
  'resale_manager',
  'unit_acquisition_manager',
  'finance_manager',
  'operations_supervisor',
];

function supportsMultipleManagers(role) {
  return MULTI_MANAGER_ROLES.has(String(role || ''));
}

function normalizeManagerIds(raw) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const ids = [];
  const seen = new Set();
  for (const item of list) {
    if (item === '' || item == null) continue;
    const id = Number(item);
    if (!Number.isFinite(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

async function validateManagerIds(managerIds, selfId) {
  const ids = normalizeManagerIds(managerIds);
  for (const id of ids) {
    if (selfId != null && String(id) === String(selfId)) {
      const err = new Error('A staff member cannot manage themselves');
      err.status = 400;
      throw err;
    }
    const { rows } = await query(`SELECT id, role FROM staff_users WHERE id = $1`, [id]);
    if (!rows[0] || rows[0].role === 'owner') {
      const err = new Error('Manager not found');
      err.status = 400;
      throw err;
    }
    if (!LINE_MANAGER_ROLES.includes(rows[0].role)) {
      const err = new Error(
        'Manager must be a CEO, HR Manager, Reservations Manager, Resale Manager, Unit Acquisition Manager, Financial Manager, or Operations Supervisor'
      );
      err.status = 400;
      throw err;
    }
  }
  return ids;
}

async function loadManagerIds(staffUserId) {
  const { rows } = await query(
    `SELECT manager_id
     FROM staff_user_managers
     WHERE staff_user_id = $1
     ORDER BY manager_id ASC`,
    [staffUserId]
  );
  return rows.map((row) => Number(row.manager_id));
}

async function syncStaffManagers(staffUserId, role, managerIds, client = null) {
  const run = client ? client.query.bind(client) : query;
  const ids = normalizeManagerIds(managerIds);
  await run(`DELETE FROM staff_user_managers WHERE staff_user_id = $1`, [staffUserId]);
  const managersToStore = supportsMultipleManagers(role) ? ids : ids.slice(0, 1);
  for (const managerId of managersToStore) {
    await run(
      `INSERT INTO staff_user_managers (staff_user_id, manager_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [staffUserId, managerId]
    );
  }
  return ids;
}

async function attachManagerIds(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;
  const staffIds = list.map((row) => row.id).filter(Boolean);
  const { rows: links } = await query(
    `SELECT staff_user_id, manager_id
     FROM staff_user_managers
     WHERE staff_user_id = ANY($1::int[])`,
    [staffIds]
  );
  const byStaff = new Map();
  for (const link of links) {
    const bucket = byStaff.get(link.staff_user_id) || [];
    bucket.push(Number(link.manager_id));
    byStaff.set(link.staff_user_id, bucket);
  }
  return list.map((row) => {
    const extra = byStaff.get(row.id) || [];
    const merged = [...new Set([...(extra || []), ...(row.manager_id ? [Number(row.manager_id)] : [])])];
    return {
      ...row,
      manager_ids: merged,
    };
  });
}

async function resolveStaffManagers(body, role, selfId) {
  if (supportsMultipleManagers(role)) {
    const source =
      body.manager_ids !== undefined
        ? body.manager_ids
        : body.manager_id !== undefined
          ? body.manager_id
          : [];
    const managerIds = await validateManagerIds(source, selfId);
    return {
      managerId: managerIds[0] ?? null,
      managerIds,
    };
  }
  if (body.manager_id === undefined && body.manager_ids === undefined) {
    return { managerId: undefined, managerIds: [] };
  }
  const managerId = await parseSingleManagerId(body.manager_id, selfId);
  return {
    managerId,
    managerIds: managerId ? [managerId] : [],
  };
}

async function parseSingleManagerId(raw, selfId) {
  if (raw === undefined) return undefined;
  if (raw === '' || raw == null) return null;
  const ids = await validateManagerIds([raw], selfId);
  return ids[0] ?? null;
}

function staffManagerIds(staff) {
  if (!staff) return [];
  const ids = new Set();
  if (Array.isArray(staff.manager_ids)) {
    for (const id of staff.manager_ids) {
      if (id != null) ids.add(String(id));
    }
  }
  if (staff.manager_id != null) ids.add(String(staff.manager_id));
  return [...ids];
}

function isDirectStaffManager(actorId, staff) {
  if (actorId == null || !staff) return false;
  return staffManagerIds(staff).includes(String(actorId));
}

function isStaffTaskManagerRole(role) {
  // Only roles selectable as line managers in User Management may assign/edit tasks.
  return LINE_MANAGER_ROLES.includes(String(role || ''));
}

function sqlStaffManagedBy(managerParam, staffAlias = 'u') {
  return `(
    ${staffAlias}.manager_id = ${managerParam}
    OR EXISTS (
      SELECT 1 FROM staff_user_managers sm
      WHERE sm.staff_user_id = ${staffAlias}.id
        AND sm.manager_id = ${managerParam}
    )
  )`;
}

module.exports = {
  MULTI_MANAGER_ROLES,
  LINE_MANAGER_ROLES,
  supportsMultipleManagers,
  normalizeManagerIds,
  validateManagerIds,
  loadManagerIds,
  syncStaffManagers,
  attachManagerIds,
  resolveStaffManagers,
  parseSingleManagerId,
  staffManagerIds,
  isDirectStaffManager,
  isStaffTaskManagerRole,
  sqlStaffManagedBy,
};
