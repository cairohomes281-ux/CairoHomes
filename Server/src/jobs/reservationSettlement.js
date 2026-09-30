const { settleReservationMoneySweep } = require('../lib/settleReservationMoney');

function startReservationSettlementJob() {
  const interval = Number(process.env.RESERVATION_SETTLEMENT_INTERVAL_MS || 6 * 60 * 60 * 1000);

  const run = async () => {
    try {
      const result = await settleReservationMoneySweep();
      const n = (result.past?.settled || 0) + (result.handed?.settled || 0);
      if (n) {
        console.log(
          `[reservation-settlement] past=${result.past.settled}/${result.past.candidates} handed=${result.handed.settled}/${result.handed.candidates}`
        );
      }
    } catch (err) {
      console.error('[reservation-settlement]', err.message);
    }
  };

  // Run once shortly after boot, then on interval
  setTimeout(run, 15_000).unref?.();
  const timer = setInterval(run, interval);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { startReservationSettlementJob };
