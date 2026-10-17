const { runChannelSync } = require('../lib/channelManager');

const INTERVAL_MS = 60 * 1000;

function startIcalSyncJob() {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const started = Date.now();
      const result = await runChannelSync();
      const errors = Number(result?.errors || 0) + Number(result?.api_errors || 0);
      const feeds = Number(result?.feeds || 0);
      const ms = Date.now() - started;
      if (errors > 0) {
        console.warn(`[ical-sync] ${errors}/${feeds || '?'} calendar feed(s) failed in ${ms}ms`);
      } else if (feeds > 0 && ms > 45000) {
        console.warn(`[ical-sync] slow sync: ${feeds} feed(s) in ${ms}ms`);
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
  console.log('[ical-sync] OTA calendars (Airbnb, Booking.com, …) sync every minute');
  return timer;
}

module.exports = { startIcalSyncJob };
