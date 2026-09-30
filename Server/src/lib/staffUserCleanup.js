const OWNERSHIP_COLUMNS = new Set(['staff_user_id', 'owner_id', 'user_id']);

const LIST_STAFF_FKS_SQL = `
  SELECT
    t.relname AS table_name,
    a.attname AS column_name,
    a.attnotnull AS not_null,
    c.confdeltype::text AS on_delete,
    c.conname AS constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = c.conkey[1]
  JOIN pg_class rt ON rt.oid = c.confrelid
  JOIN pg_namespace rn ON rn.oid = rt.relnamespace
  WHERE c.contype = 'f'
    AND rn.nspname = 'public'
    AND rt.relname = 'staff_users'
    AND n.nspname = 'public'
    AND array_length(c.conkey, 1) = 1
`;

function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ''))) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

function classifyStaffFk({ columnName, notNull, onDelete }) {
  const del = String(onDelete || 'a');
  if (del === 'c' || del === 'n' || del === 'd') return 'skip';
  if (OWNERSHIP_COLUMNS.has(columnName)) {
    return notNull ? 'delete' : 'null';
  }
  if (!notNull) return 'null';
  return 'reassign';
}

function asStaffDeleteError(err) {
  if (err?.code !== '23503') return err;
  console.error('[pms] staff user delete FK', err.constraint, err.detail);
  const wrapped = new Error(
    'This account is still linked to other records and cannot be deleted.'
  );
  wrapped.status = 409;
  wrapped.cause = err;
  return wrapped;
}

async function detachStaffUserReferences(client, targetId, actorId) {
  const { rows } = await client.query(LIST_STAFF_FKS_SQL);
  const fks = rows.map((row) => ({
    tableName: row.table_name,
    columnName: row.column_name,
    action: classifyStaffFk({
      columnName: row.column_name,
      notNull: row.not_null,
      onDelete: row.on_delete,
    }),
  }));

  for (const fk of fks.filter((item) => item.action === 'null')) {
    await client.query(
      `UPDATE ${quoteIdent(fk.tableName)} SET ${quoteIdent(fk.columnName)} = NULL WHERE ${quoteIdent(fk.columnName)} = $1`,
      [targetId]
    );
  }

  for (const fk of fks.filter((item) => item.action === 'reassign')) {
    await client.query(
      `UPDATE ${quoteIdent(fk.tableName)} SET ${quoteIdent(fk.columnName)} = $2 WHERE ${quoteIdent(fk.columnName)} = $1`,
      [targetId, actorId]
    );
  }

  let remaining = fks.filter((item) => item.action === 'delete');
  let lastErr = null;
  for (let attempt = 0; attempt < 8 && remaining.length; attempt += 1) {
    const next = [];
    lastErr = null;
    for (const fk of remaining) {
      try {
        await client.query(
          `DELETE FROM ${quoteIdent(fk.tableName)} WHERE ${quoteIdent(fk.columnName)} = $1`,
          [targetId]
        );
      } catch (err) {
        if (err.code === '23503') {
          lastErr = err;
          next.push(fk);
        } else {
          throw err;
        }
      }
    }
    if (next.length === remaining.length) {
      throw lastErr || new Error('Could not detach staff user ownership rows');
    }
    remaining = next;
  }
  if (remaining.length) {
    throw lastErr || new Error('Could not detach staff user ownership rows');
  }
}

module.exports = {
  OWNERSHIP_COLUMNS,
  classifyStaffFk,
  quoteIdent,
  detachStaffUserReferences,
  asStaffDeleteError,
};
