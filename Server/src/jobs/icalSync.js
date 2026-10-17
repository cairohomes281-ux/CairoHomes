const { runChannelSync } = require('../lib/channelManager');

const INTERVAL_MS = 60 * 1000;

function startIcalSyncJob() {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await runChannelSync();
      const errors = Number(result?.errors || 0) + Number(result?.api_errors || 0);
      if (errors > 0) {
        console.warn(`[ical-sync] ${errors} calendar feed(s) failed`);
      }
      try {
        const { purgeStaleReservationBlocks } = require('../lib/reservationBlocks');
        const purged = await purgeStaleReservationBlocks();
        if (purged) console.log(`[ical-sync] purged ${purged} stale reservation block night(s)`);
      } catch (purgeErr) {
        console.warn('[ical-sync] block purge failed', purgeErr.message);
      }
    } catch (err) {
      console.error('[ical-sync]', err.message);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, INTERVAL_MS);
  if (timer.unref) timer.unref();
  setTimeout(tick, 5000);
  console.log('[ical-sync] Airbnb calendar syncs every minute');
  return timer;
}

module.exports = { startIcalSyncJob };
