const express = require('express');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { parseRange } = require('../../lib/siteTelemetry');

const router = express.Router();
const guard = requireRoles('web_developer');
const CAIRO_DATE = `(created_at AT TIME ZONE 'Africa/Cairo')::date`;

router.get('/site-health/errors', guard, async (req, res, next) => {
  try {
    const { from, to } = parseRange(req.query);
    const range = [`${CAIRO_DATE} BETWEEN $1::date AND $2::date`, [from, to]];

    const [{ rows: grouped }, { rows: recent }, { rows: byType }, { rows: totals }] = await Promise.all([
      query(
        `SELECT fingerprint, error_type,
                MIN(message) AS message,
                MIN(path) AS path,
                MAX(status_code) AS status_code,
                COUNT(*)::int AS count,
                MAX(created_at) AS last_seen
           FROM site_guest_errors
          WHERE ${range[0]}
          GROUP BY fingerprint, error_type
          ORDER BY count DESC, last_seen DESC
          LIMIT 60`,
        range[1]
      ),
      query(
        `SELECT id, fingerprint, error_type, message, path, status_code, created_at
           FROM site_guest_errors
          WHERE ${range[0]}
          ORDER BY created_at DESC
          LIMIT 40`,
        range[1]
      ),
      query(
        `SELECT error_type, COUNT(*)::int AS count
           FROM site_guest_errors
          WHERE ${range[0]}
          GROUP BY error_type
          ORDER BY count DESC`,
        range[1]
      ),
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ${CAIRO_DATE} = (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::date)::int AS today
           FROM site_guest_errors
          WHERE ${range[0]}`,
        range[1]
      ),
    ]);

    res.json({
      from,
      to,
      totals: totals[0] || { total: 0, today: 0 },
      by_type: byType,
      frequent: grouped,
      recent,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/site-health/performance', guard, async (req, res, next) => {
  try {
    const { from, to } = parseRange(req.query);
    const rangeSql = `${CAIRO_DATE} BETWEEN $1::date AND $2::date`;
    const params = [from, to];

    const [{ rows: funnel }, { rows: pages }, { rows: daily }, { rows: totals }] = await Promise.all([
      query(
        `SELECT event,
                COUNT(*)::int AS hits,
                COUNT(DISTINCT session_id)::int AS sessions
           FROM site_guest_events
          WHERE ${rangeSql}
            AND event = ANY($3::text[])
          GROUP BY event`,
        [
          from,
          to,
          [
            'view_home',
            'view_search',
            'view_listing',
            'view_checkout',
            'view_payment',
            'booking_submitted',
            'payment_success',
            'payment_fail',
          ],
        ]
      ),
      query(
        `SELECT path,
                COUNT(*)::int AS views,
                ROUND(AVG(duration_ms))::int AS avg_ms,
                ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY duration_ms))::numeric)::int AS p90_ms
           FROM site_guest_events
          WHERE ${rangeSql}
            AND event = 'page_timing'
            AND duration_ms IS NOT NULL
          GROUP BY path
          ORDER BY views DESC
          LIMIT 20`,
        params
      ),
      query(
        `SELECT ${CAIRO_DATE} AS date, COUNT(*)::int AS count
           FROM site_guest_events
          WHERE ${rangeSql}
            AND event LIKE 'view_%'
          GROUP BY 1
          ORDER BY 1`,
        params
      ),
      query(
        `SELECT COUNT(*) FILTER (WHERE event LIKE 'view_%')::int AS page_views,
                COUNT(DISTINCT session_id)::int AS sessions,
                COUNT(*) FILTER (WHERE event = 'booking_submitted')::int AS bookings,
                COUNT(*) FILTER (WHERE event = 'payment_fail')::int AS payment_fails
           FROM site_guest_events
          WHERE ${rangeSql}`,
        params
      ),
    ]);

    const funnelOrder = [
      'view_home',
      'view_search',
      'view_listing',
      'view_checkout',
      'view_payment',
      'booking_submitted',
      'payment_success',
    ];
    const byEvent = Object.fromEntries(funnel.map((row) => [row.event, row]));

    res.json({
      from,
      to,
      totals: totals[0] || { page_views: 0, sessions: 0, bookings: 0, payment_fails: 0 },
      funnel: funnelOrder.map((event) => ({
        event,
        hits: byEvent[event]?.hits || 0,
        sessions: byEvent[event]?.sessions || 0,
      })),
      pages,
      daily: daily.map((row) => ({ date: String(row.date).slice(0, 10), count: row.count })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/site-health/bookings', guard, async (req, res, next) => {
  try {
    const { from, to } = parseRange(req.query);
    const rangeSql = `${CAIRO_DATE} BETWEEN $1::date AND $2::date`;
    const params = [from, to];

    const [
      { rows: bookingStatus },
      { rows: cardSessions },
      { rows: stuck },
      { rows: failedCards },
      { rows: abandoned },
      { rows: funnel },
    ] = await Promise.all([
      query(
        `SELECT status, COALESCE(payment_status, '') AS payment_status,
                COALESCE(payment_method, '') AS payment_method,
                COUNT(*)::int AS count
           FROM bookings
          WHERE ${rangeSql}
          GROUP BY 1, 2, 3
          ORDER BY count DESC`,
        params
      ),
      query(
        `SELECT status, COUNT(*)::int AS count
           FROM card_checkout_sessions
          WHERE ${rangeSql}
          GROUP BY status
          ORDER BY count DESC`,
        params
      ),
      query(
        `SELECT id, listing_title, listing_slug, status, payment_status, payment_method, created_at
           FROM bookings
          WHERE status IN ('pending', 'held')
            AND created_at < now() - interval '2 hours'
          ORDER BY created_at ASC
          LIMIT 25`
      ),
      query(
        `SELECT id, status, amount_cents, created_at,
                payload->>'slug' AS listing_slug
           FROM card_checkout_sessions
          WHERE status = 'failed'
            AND ${rangeSql}
          ORDER BY created_at DESC
          LIMIT 25`,
        params
      ),
      query(
        `SELECT id, status, amount_cents, created_at,
                payload->>'slug' AS listing_slug
           FROM card_checkout_sessions
          WHERE status = 'pending'
            AND created_at < now() - interval '30 minutes'
            AND ${rangeSql}
          ORDER BY created_at ASC
          LIMIT 25`,
        params
      ),
      query(
        `SELECT
            COUNT(DISTINCT session_id) FILTER (WHERE event = 'view_checkout')::int AS checkout_sessions,
            COUNT(DISTINCT session_id) FILTER (WHERE event = 'view_payment')::int AS payment_sessions,
            COUNT(DISTINCT session_id) FILTER (WHERE event IN ('booking_submitted', 'payment_success'))::int AS completed_sessions,
            COUNT(*) FILTER (WHERE event = 'payment_fail')::int AS payment_fails
           FROM site_guest_events
          WHERE ${rangeSql}`,
        params
      ),
    ]);

    const started = Math.max(
      Number(funnel[0]?.checkout_sessions || 0),
      Number(funnel[0]?.payment_sessions || 0)
    );
    const completed = Number(funnel[0]?.completed_sessions || 0);
    const failedCardCount = cardSessions
      .filter((row) => row.status === 'failed')
      .reduce((sum, row) => sum + Number(row.count || 0), 0);

    res.json({
      from,
      to,
      totals: {
        website_bookings: bookingStatus.reduce((sum, row) => sum + Number(row.count || 0), 0),
        card_sessions: cardSessions.reduce((sum, row) => sum + Number(row.count || 0), 0),
        stuck: stuck.length,
        failed_cards: failedCardCount,
        abandoned_cards: abandoned.length,
        checkout_started: started,
        checkout_completed: completed,
        abandoned_checkouts: Math.max(0, started - completed),
        payment_fails: Number(funnel[0]?.payment_fails || 0),
      },
      booking_status: bookingStatus,
      card_sessions: cardSessions,
      stuck_requests: stuck,
      failed_cards: failedCards,
      abandoned_cards: abandoned,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
