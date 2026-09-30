const { query } = require('../config/db');


async function logAudit({ userId, action, entityType, entityId, details } = {}) {
  try {
    if (!action) return;
    await query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))`,
      [
        userId || null,
        String(action),
        entityType ? String(entityType) : null,
        entityId != null ? String(entityId) : null,
        details != null ? JSON.stringify(details) : null,
      ]
    );
  } catch (err) {
    console.error('[audit]', err.message);
  }
}

module.exports = { logAudit };
