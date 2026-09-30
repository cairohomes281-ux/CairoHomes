const express = require('express');
const { query } = require('../config/db');

const router = express.Router();

router.get('/:slug.ics', async (req, res, next) => {
  try {
    const slug = req.params.slug.replace(/\.ics$/, '');
    const { rows: units } = await query(`SELECT * FROM units WHERE slug = $1`, [slug]);
    const unit = units[0];
    if (!unit) return res.status(404).send('Not found');

    const { rows: bookings } = await query(
      `SELECT checkin, checkout, guest_name, id FROM bookings
       WHERE listing_slug = $1 AND status IN ('confirmed','pending','held')
         AND (hold_expires_at IS NULL OR hold_expires_at > now())`,
      [unit.slug]
    );
    const { rows: reservations } = await query(
      `SELECT check_in AS checkin, check_out AS checkout, id
       FROM reservations
       WHERE unit_id = $1 AND status <> 'cancelled'`,
      [unit.id]
    );

    // Explicit schedule / owner holds — same nights guest calendars treat as closed.
    const { rows: blocked } = await query(
      `SELECT date::text AS date, COALESCE(source, 'manual') AS source
       FROM unit_blocked_dates
       WHERE wp_post_id = $1
         AND date >= CURRENT_DATE - 1
         AND COALESCE(source, 'manual') NOT IN ('reservation', 'reservation_import', 'booking')
       ORDER BY date`,
      [unit.wp_post_id]
    );

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Cairo Homes Hospitality Channel Manager//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    function pushEvent(uid, checkin, checkout, summary) {
      const dtStart = String(checkin).replace(/-/g, '').slice(0, 8);
      const dtEnd = String(checkout).replace(/-/g, '').slice(0, 8);
      if (!dtStart || !dtEnd) return;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}@cairohomes.com`,
        `DTSTART;VALUE=DATE:${dtStart}`,
        `DTEND;VALUE=DATE:${dtEnd}`,
        `SUMMARY:${summary}`,
        'END:VEVENT'
      );
    }

    for (const b of bookings) {
      pushEvent(b.id, b.checkin, b.checkout, 'Booked');
    }
    for (const r of reservations) {
      pushEvent(`res-${r.id}`, r.checkin, r.checkout, 'Booked');
    }

    // Collapse consecutive blocked nights into DATE ranges (DTEND exclusive).
    let rangeStart = null;
    let rangeEnd = null;
    let rangeIdx = 0;
    const flushRange = () => {
      if (!rangeStart) return;
      pushEvent(`block-${unit.id}-${rangeIdx++}`, rangeStart, rangeEnd, 'Blocked');
      rangeStart = null;
      rangeEnd = null;
    };
    for (const row of blocked) {
      const d = row.date;
      if (!rangeStart) {
        rangeStart = d;
        const next = new Date(`${d}T00:00:00`);
        next.setDate(next.getDate() + 1);
        rangeEnd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
        continue;
      }
      if (d === rangeEnd) {
        const next = new Date(`${d}T00:00:00`);
        next.setDate(next.getDate() + 1);
        rangeEnd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      } else {
        flushRange();
        rangeStart = d;
        const next = new Date(`${d}T00:00:00`);
        next.setDate(next.getDate() + 1);
        rangeEnd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
      }
    }
    flushRange();

    lines.push('END:VCALENDAR');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, max-age=0');
    res.send(lines.join('\r\n'));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
