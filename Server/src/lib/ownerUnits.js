const { pool, query } = require('../config/db');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeUnitIds(unitIds) {
  return [
    ...new Set(
      (Array.isArray(unitIds) ? unitIds : [])
        .map((id) => String(id ?? '').trim())
        .filter((id) => UUID_RE.test(id))
    ),
  ];
}

/**
 * Replace an owner's portal unit links.
 * Only rent units that are unlinked (or already linked to this owner) may be assigned.
 * Unit owner_name / owner_phone are ignored.
 */
async function setOwnerUnits(ownerId, unitIds) {
  const oid = Number(ownerId);
  if (!Number.isInteger(oid) || oid <= 0) {
    const err = new Error('Invalid owner id');
    err.status = 400;
    throw err;
  }

  const ids = normalizeUnitIds(unitIds);

  const { rows: ownerRows } = await query(
    `SELECT id FROM staff_users WHERE id = $1 AND role = 'owner'`,
    [oid]
  );
  if (!ownerRows[0]) {
    const err = new Error('Owner not found');
    err.status = 404;
    throw err;
  }

  if (ids.length) {
    const { rows: units } = await query(
      `SELECT id FROM units WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    if (units.length !== ids.length) {
      const err = new Error('One or more units are invalid');
      err.status = 400;
      throw err;
    }

    const { rows: taken } = await query(
      `SELECT ou.unit_id, s.full_name AS owner_name
       FROM owner_units ou
       JOIN staff_users s ON s.id = ou.owner_id
       WHERE ou.unit_id = ANY($1::uuid[])
         AND ou.owner_id <> $2`,
      [ids, oid]
    );
    if (taken.length) {
      const labels = taken.map((t) => `${t.unit_id} (${t.owner_name})`).join(', ');
      const err = new Error(`Unit(s) already linked to another owner: ${labels}`);
      err.status = 409;
      throw err;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM owner_units WHERE owner_id = $1`, [oid]);
    for (const unitId of ids) {
      await client.query(
        `INSERT INTO owner_units (owner_id, unit_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [oid, unitId]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  const { rows } = await query(
    `SELECT u.id, u.title, u.unit_number, u.project, u.compound,
            COALESCE(u.unit_number, u.title) AS name
     FROM owner_units ou
     JOIN units u ON u.id = ou.unit_id
     WHERE ou.owner_id = $1
     ORDER BY u.unit_number NULLS LAST, u.title`,
    [oid]
  );
  return rows;
}

async function listLinkableUnits(ownerId) {
  const oid =
    ownerId != null && ownerId !== ''
      ? Number(ownerId)
      : null;
  const params = [];
  let ownerFilter = 'ou.owner_id IS NULL';
  if (Number.isInteger(oid) && oid > 0) {
    params.push(oid);
    ownerFilter = `(ou.owner_id IS NULL OR ou.owner_id = $1)`;
  }

  const { rows } = await query(
    `SELECT u.id, u.title, u.unit_number, u.project, u.compound,
            u.owner_name AS unit_owner_name, u.owner_phone AS unit_owner_phone,
            ou.owner_id AS linked_owner_id,
            COALESCE(u.unit_number, u.title) AS name,
            COALESCE(u.project, u.compound) AS project_label
     FROM units u
     LEFT JOIN owner_units ou ON ou.unit_id = u.id
     WHERE ${ownerFilter}
     ORDER BY COALESCE(u.project, u.compound) NULLS LAST,
              u.unit_number NULLS LAST,
              u.title`,
    params
  );

  // A unit with multiple owner_units rows could duplicate; keep one row per unit.
  const byId = new Map();
  for (const row of rows) {
    const id = String(row.id);
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        title: row.title,
        unit_number: row.unit_number,
        name: row.unit_number || row.name || row.title,
        project: row.project || row.compound || row.project_label,
        unit_owner_name: row.unit_owner_name || null,
        unit_owner_phone: row.unit_owner_phone || null,
        linked_to_owner: Boolean(
          oid && row.linked_owner_id && Number(row.linked_owner_id) === oid
        ),
      });
      continue;
    }
    if (oid && row.linked_owner_id && Number(row.linked_owner_id) === oid) {
      existing.linked_to_owner = true;
    }
  }
  return [...byId.values()];
}

module.exports = {
  normalizeUnitIds,
  setOwnerUnits,
  listLinkableUnits,
};
