const { query } = require('../../config/db');
const { CHANNEL_REPORT_BUCKETS, channelReportBucket } = require('../bookingSources');

/**
 * Per-channel reservation counts and revenue for dashboards.
 * Buckets: Airbnb, Booking.com, Website, Manual (other sources fold into Manual).
 */
async function channelRevenueSummary({ from = null, to = null, agentId = null } = {}) {
  const params = [];
  const filters = [`r.status <> 'cancelled'`];
  if (from) {
    params.push(from);
    filters.push(`r.check_in >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    filters.push(`r.check_in <= $${params.length}::date`);
  }
  if (agentId != null) {
    params.push(agentId);
    filters.push(`(r.sales_person_id = $${params.length} OR r.created_by = $${params.length})`);
  }

  const { rows } = await query(
    `SELECT
       r.booking_source,
       r.booking_id,
       COALESCE(r.total_amount, 0)::float AS gross,
       COALESCE(r.channel_commission_amount, 0)::float AS commission_amount,
       r.channel_commission_pct
     FROM reservations r
     WHERE ${filters.join(' AND ')}`,
    params
  );

  const byChannel = Object.fromEntries(
    CHANNEL_REPORT_BUCKETS.map((name) => [
      name,
      { channel: name, count: 0, gross: 0, commission: 0, net: 0 },
    ])
  );

  for (const row of rows) {
    const bucket = channelReportBucket(row.booking_source, { hasBookingId: Boolean(row.booking_id) });
    const entry = byChannel[bucket] || byChannel.Manual;
    const gross = Number(row.gross) || 0;
    let commission = Number(row.commission_amount) || 0;
    if (!commission && row.channel_commission_pct != null && gross) {
      commission = (gross * Number(row.channel_commission_pct)) / 100;
    }
    entry.count += 1;
    entry.gross += gross;
    entry.commission += commission;
    entry.net += gross - commission;
  }

  const channels = CHANNEL_REPORT_BUCKETS.map((name) => {
    const e = byChannel[name];
    return {
      channel: name,
      count: e.count,
      gross: Math.round(e.gross * 100) / 100,
      commission: Math.round(e.commission * 100) / 100,
      net: Math.round(e.net * 100) / 100,
    };
  });

  const totals = channels.reduce(
    (acc, c) => {
      acc.count += c.count;
      acc.gross += c.gross;
      acc.commission += c.commission;
      acc.net += c.net;
      return acc;
    },
    { count: 0, gross: 0, commission: 0, net: 0 }
  );

  return { channels, totals };
}

module.exports = { channelRevenueSummary };
