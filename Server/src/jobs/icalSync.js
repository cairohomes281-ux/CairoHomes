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
    } catch (err) {
      console.error('[ical-sync]', err.message);
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, INTERVAL_MS);
  if (timer.unref) timer.unref();
  setTimeout(tick, 5000);
  console.log('[ical-sync] Airbnb and Booking.com calendars sync every minute');
  return timer;
}

module.exports = { startIcalSyncJob };
