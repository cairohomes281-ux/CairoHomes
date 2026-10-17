const express = require('express');
const { query } = require('../config/db');
const { buildExportEvents, renderExportIcs } = require('../services/calendarExport');

const router = express.Router();

router.get('/:slug.ics', async (req, res, next) => {
  try {
    const slug = req.params.slug.replace(/\.ics$/, '');
    const { rows: units } = await query(
      `SELECT id, slug, title, wp_post_id FROM units WHERE slug = $1`,
      [slug]
    );
    const unit = units[0];
    if (!unit) return res.status(404).send('Not found');

    // Website holds / bookings — match by slug or listing wp id.
    const { rows: bookings } = await query(
      `SELECT id, checkin::text AS checkin, checkout::text AS checkout
       FROM bookings
       WHERE status IN ('confirmed','pending','held')
         AND (hold_expires_at IS NULL OR hold_expires_at > now())
         AND (
           listing_slug = $1
           OR listing_wp_id = $2
           OR unit_id = $3
         )`,
      [unit.slug, unit.wp_post_id, unit.id]
    );

    // Active PMS stays + recent cancels (tombstones) for Airbnb to clear nights.
    // Skip Airbnb-imported rows (ota_event_uid) — echoing those causes sync fights.
    const { rows: reservations } = await query(
      `SELECT id, check_in::text AS check_in, check_out::text AS check_out,
              status, updated_at, ota_event_uid
       FROM reservations
       WHERE unit_id = $1
         AND ota_event_uid IS NULL
         AND (
           status IS DISTINCT FROM 'cancelled'
           OR (
             status = 'cancelled'
             AND updated_at >= (CURRENT_DATE - INTERVAL '45 days')
           )
         )
         AND (hold_expires_at IS NULL OR hold_expires_at > now() OR status = 'cancelled')`,
      [unit.id]
    );

    // Explicit schedule / owner holds only — not reservation echoes, not Airbnb cache.
    const { rows: blocked } = await query(
      `SELECT date::text AS date
       FROM unit_blocked_dates
       WHERE wp_post_id = $1
         AND date >= CURRENT_DATE - 1
         AND COALESCE(source, 'manual') NOT IN ('reservation', 'reservation_import', 'booking')
       ORDER BY date`,
      [unit.wp_post_id]
    );

    const events = buildExportEvents({
      unit,
      bookings,
      reservations,
      blockedDates: blocked.map((r) => r.date),
    });
    const body = renderExportIcs(events, {
      calendarName: unit.title || unit.slug || 'Cairo Homes',
    });

    const lastUpdated = reservations.reduce((max, r) => {
      const t = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      return t > max ? t : max;
    }, 0);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${unit.slug}.ics"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    if (lastUpdated) res.setHeader('Last-Modified', new Date(lastUpdated).toUTCString());
    res.send(body);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
