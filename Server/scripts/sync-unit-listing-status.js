/**
 * Recompute every unit to draft or published from completeness.
 * Usage: node scripts/sync-unit-listing-status.js
 */
require('dotenv').config();
const { query, pool } = require('../src/config/db');
const { syncUnitListingStatus } = require('../src/lib/unitListingStatus');

async function main() {
  const { rows: beforeCounts } = await query(
    `SELECT status, COUNT(*)::int AS count FROM units GROUP BY status ORDER BY status`
  );
  console.log('Before:', JSON.stringify(beforeCounts));

  const { rows } = await query(
    `SELECT id, title, unit_number, status FROM units ORDER BY unit_number NULLS LAST, title`
  );
  let changed = 0;
  let published = 0;
  let draft = 0;
  for (const row of rows) {
    const before = row.status;
    const synced = await syncUnitListingStatus(row.id);
    if (!synced) continue;
    if (synced.status === 'published') published += 1;
    else draft += 1;
    if (synced.status !== before) {
      changed += 1;
      const missing = synced._completeness?.missing?.join(', ') || '';
      const label = row.unit_number || row.title || row.id;
      console.log(`${before} → ${synced.status}: ${label}${missing ? ` (${missing})` : ''}`);
    }
  }

  const { rows: afterCounts } = await query(
    `SELECT status, COUNT(*)::int AS count FROM units GROUP BY status ORDER BY status`
  );
  console.log(
    `Done. total=${rows.length} changed=${changed} published=${published} draft=${draft}`
  );
  console.log('After:', JSON.stringify(afterCounts));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
