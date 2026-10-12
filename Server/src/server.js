require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const http = require('http');
const bcrypt = require('bcryptjs');
const { createApp } = require('./app');
const { runMigrations, query } = require('./config/db');
const { ensureStaffTaskTables } = require('./lib/staffTaskSchema');
const { initSocket } = require('./config/socket');
const { startBookingHoldExpiryJob } = require('./jobs/bookingHoldExpiry');
const { startPmsReminderJobs } = require('./jobs/pmsReminders');
const { startDataRetentionJob } = require('./jobs/dataRetention');
const { startReservationSettlementJob } = require('./jobs/reservationSettlement');
const { startMonthlySalaryExpenseJob } = require('./jobs/monthlySalaryExpenses');
const { startIcalSyncJob } = require('./jobs/icalSync');
const { syncAllUnitListingStatusesOnBoot } = require('./lib/bootUnitStatusSync');

async function seedAdmin() {
  const username = 'admin';
  const email = process.env.ADMIN_EMAIL || 'admin@cairohomes.com';
  const password = 'Admin899#';
  const hash = await bcrypt.hash(password, 10);

  const { rows } = await query(`SELECT id FROM staff_users WHERE username = $1`, [username]);
  if (rows.length) {
    await query(
      `UPDATE staff_users
       SET password_hash = $1,
           email = COALESCE($2, email),
           role = 'admin',
           is_active = 1,
           is_first_login = 0,
           updated_at = now()
       WHERE username = $3 AND id = $4`,
      [hash, email, username, rows[0].id]
    );
    return;
  }

  await query(
    `INSERT INTO staff_users (username, password_hash, email, full_name, role, is_first_login)
     VALUES ($1,$2,$3,$4,'admin',0)`,
    [username, hash, email, 'System Admin']
  );
  console.log(`[seed] Created staff admin user "${username}"`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.warn('[boot] DATABASE_URL not set — migrations/API will fail until configured');
  } else {
    await runMigrations();
    try {
      await ensureStaffTaskTables();
    } catch (err) {
      console.error('[boot] staff task tables ensure failed:', err.message);
    }
    await seedAdmin();
    try {
      await syncAllUnitListingStatusesOnBoot();
    } catch (err) {
      console.error('[boot] Unit listing sync failed:', err.message);
    }
  }

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  startBookingHoldExpiryJob();
  startPmsReminderJobs();
  startDataRetentionJob();
  startReservationSettlementJob();
  startMonthlySalaryExpenseJob();
  startIcalSyncJob();

  const port = Number(process.env.PORT || 5000);
  server.listen(port, () => {
    console.log(`[cairo-homes] API listening on :${port}`);
    console.log(
      `[cairo-homes] commit=${process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || 'local'}`
    );
  });
}

main().catch((err) => {
  console.error('[boot] fatal', err);
  process.exit(1);
});
