const { query } = require('../../config/db');

async function writeSyncLog({
  connectionId = null,
  feedId = null,
  unitId = null,
  providerKey,
  direction,
  operation,
  status,
  message = null,
  details = {},
} = {}) {
  try {
    const { rows } = await query(
      `INSERT INTO channel_sync_logs
         (connection_id, feed_id, unit_id, provider_key, direction, operation, status, message, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING *`,
      [
        connectionId,
        feedId,
        unitId,
        providerKey,
        direction,
        operation,
        status,
        message,
        JSON.stringify(details || {}),
      ]
    );
    return rows[0];
  } catch (err) {
    // Table may not exist until migration runs; never break sync for logging.
    console.warn('[channelManager] sync log skipped:', err.message);
    return null;
  }
}

async function listSyncLogs({ limit = 50, feedId = null, connectionId = null, unitId = null } = {}) {
  const params = [];
  const clauses = [];
  if (feedId) {
    params.push(feedId);
    clauses.push(`feed_id = $${params.length}`);
  }
  if (connectionId) {
    params.push(connectionId);
    clauses.push(`connection_id = $${params.length}`);
  }
  if (unitId) {
    params.push(unitId);
    clauses.push(`unit_id = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT * FROM channel_sync_logs
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

module.exports = { writeSyncLog, listSyncLogs };
