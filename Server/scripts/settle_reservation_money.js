require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { pool } = require('../src/config/db');
const { settleReservationMoneySweep } = require('../src/lib/settleReservationMoney');

(async () => {
  const result = await settleReservationMoneySweep();
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
