const { query } = require('../config/db');

/** Bump session version so existing JWTs stop working on all devices. */
async function bumpStaffAuthSessions(userId) {
  const { rows } = await query(
    `UPDATE staff_users
     SET auth_token_version = COALESCE(auth_token_version, 0) + 1,
         updated_at = now()
     WHERE id = $1
     RETURNING COALESCE(auth_token_version, 0)::int AS auth_token_version`,
    [userId]
  );
  return Number(rows[0]?.auth_token_version) || 0;
}

function staffTokenVersion(userOrRow) {
  return Number(userOrRow?.auth_token_version) || 0;
}

function tokenVersionMatches(payload, userOrRow) {
  const tokenTv = payload?.tv == null ? 0 : Number(payload.tv);
  const current = staffTokenVersion(userOrRow);
  return Number.isFinite(tokenTv) && tokenTv === current;
}

module.exports = {
  bumpStaffAuthSessions,
  staffTokenVersion,
  tokenVersionMatches,
};
