const { query } = require('../config/db');
const { syncUnitListingStatus } = require('./unitListingStatus');


async function syncAllUnitListingStatusesOnBoot() {
  const { rows } = await query(
    `SELECT id, status FROM units ORDER BY created_at`
  );
  let changed = 0;
  for (const row of rows) {
    const synced = await syncUnitListingStatus(row.id);
    if (synced && synced.status !== row.status) changed += 1;
  }
  const { rows: counts } = await query(
    `SELECT status, COUNT(*)::int AS count FROM units GROUP BY status ORDER BY status`
  );
  console.log(
    `[boot] Unit listing sync done. checked=${rows.length} changed=${changed} counts=${JSON.stringify(counts)}`
  );
  return { checked: rows.length, changed, counts };
}

module.exports = { syncAllUnitListingStatusesOnBoot };
