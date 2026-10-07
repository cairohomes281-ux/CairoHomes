const { query } = require('../config/db');
const { syncBlocksForReservation, resyncReservationBlocks } = require('../lib/reservationBlocks');
const { notifyStaff } = require('./pmsNotifications');

const PLATFORM_LABELS = { airbnb: 'Airbnb', booking: 'Booking.com' };
const PLATFORM_ORDER = { airbnb: 0, booking: 1 };
const NON_RESERVATION_BLOCK_SOURCES = ['reservation', 'reservation_import', 'booking'];

function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ymdFrom(raw) {
  const m = /([0-9]{4})([0-9]{2})([0-9]{2})/.exec(String(raw || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function unescapeText(v) {
  return String(v || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

function prop(block, name) {
  const m = new RegExp(`^${name}(?:;[^:\\n]*)?:(.*)$`, 'im').exec(block);
  return m ? m[1].trim() : null;
}

function parseIcalEvents(ics) {
  const unfolded = String(ics || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '');
  const blocks = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  return blocks.map((raw) => {
    const block = raw.split(/END:VEVENT/i)[0];
    const start = ymdFrom(prop(block, 'DTSTART'));
    const end = ymdFrom(prop(block, 'DTEND'));
    return {
      uid: prop(block, 'UID'),
      summary: unescapeText(prop(block, 'SUMMARY')),
      description: unescapeText(prop(block, 'DESCRIPTION')),
      start,
      end,
    };
  });
}

/** Airbnb marks guest stays "Reserved"; its other events are host blocks. Booking.com marks everything "CLOSED". */
function isReservationEvent(platform, event) {
  if (platform === 'airbnb') return /reserved/i.test(event.summary || '');
  if (platform === 'booking') return true;
  return false;
}

function airbnbDetails(description) {
  const text = String(description || '');
  const code =
    /reservations\/details\/([A-Z0-9]+)/i.exec(text)?.[1] || /\b(HM[A-Z0-9]{6,})\b/.exec(text)?.[1] || null;
  const last4 = /last\s*4\s*digits\)?\s*:\s*(\d{4})/i.exec(text)?.[1] || null;
  return { code: code ? code.toUpperCase() : null, last4 };
}

function nightsBetween(checkIn, checkOut) {
  return Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000));
}

async function systemStaffId() {
  const { rows } = await query(
    `SELECT id FROM staff_users WHERE role = 'admin' ORDER BY is_active DESC, id LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

async function hasConflict(feed, unitId, checkIn, checkOut) {
  const { rows } = await query(
    `SELECT 1 FROM reservations
     WHERE unit_id = $1 AND status <> 'cancelled' AND check_in < $3::date AND check_out > $2::date
     LIMIT 1`,
    [unitId, checkIn, checkOut]
  );
  if (rows[0]) return true;
  if (feed.platform !== 'booking') return false;

  // Booking.com re-exports dates it imported from Airbnb / Cairo Homes as "CLOSED" too.
  const { rows: echoes } = await query(
    `SELECT 1 FROM unit_blocked_dates
     WHERE wp_post_id = $1 AND date >= $2::date AND date < $3::date
       AND COALESCE(source, 'manual') <> ALL($4::text[])
     UNION ALL
     SELECT 1 FROM unit_ical_blocks
     WHERE wp_post_id = $1 AND feed_id <> $5 AND date >= $2::date AND date < $3::date
     UNION ALL
     SELECT 1 FROM bookings
     WHERE listing_wp_id = $1 AND status IN ('confirmed','pending','held')
       AND checkin < $3::date AND checkout > $2::date
     LIMIT 1`,
    [feed.wp_post_id, checkIn, checkOut, NON_RESERVATION_BLOCK_SOURCES, feed.id]
  );
  return Boolean(echoes[0]);
}

function placeholderNotes(label, details) {
  const bits = [`Imported from the ${label} calendar.`];
  if (details.code) bits.push(`Reservation code: ${details.code}.`);
  if (details.last4) bits.push(`Guest phone ends in ${details.last4}.`);
  bits.push(`Add the guest name, phone and amount paid from ${label}.`);
  return bits.join(' ');
}

async function notifyAdmins({ type, title, message, reservationId }) {
  try {
    await notifyStaff({
      roles: ['admin'],
      type,
      title,
      message,
      entity_type: 'reservation',
      entity_id: reservationId,
    });
  } catch (err) {
    console.warn('[ota-ical] notify failed', err.message);
  }
}

/**
 * Create, update or cancel placeholder reservations for one feed's iCal events.
 * Only stays that end today or later are touched.
 */
async function importFeedReservations(feed, ics) {
  const label = PLATFORM_LABELS[feed.platform];
  const result = { created: 0, updated: 0, cancelled: 0, skipped: 0 };
  if (!label || !feed.unit_id || !/END:VCALENDAR/i.test(String(ics || ''))) return result;

  const today = localIso(new Date());
  const events = parseIcalEvents(ics).filter(
    (e) => e.uid && e.start && e.end && e.end > e.start && isReservationEvent(feed.platform, e)
  );
  const upcoming = events.filter((e) => e.end > today);
  const unitTitle = feed.unit_title || feed.unit_slug || 'unit';

  const { rows: imported } = await query(
    `SELECT id, unit_id, status, check_in::text AS check_in, check_out::text AS check_out,
            ota_event_uid, ota_removed_at
     FROM reservations WHERE ota_feed_id = $1`,
    [feed.id]
  );
  const byUid = new Map(imported.map((r) => [r.ota_event_uid, r]));
  const seen = new Set();
  let createdBy = null;

  for (const ev of upcoming) {
    const details = feed.platform === 'airbnb' ? airbnbDetails(ev.description) : { code: null, last4: null };
    let existing = byUid.get(ev.uid);
    if (!existing) {
      existing = imported.find(
        (r) => !seen.has(r.id) && r.check_in === ev.start && r.check_out === ev.end
      );
    }

    if (existing) {
      seen.add(existing.id);
      const datesChanged = existing.check_in !== ev.start || existing.check_out !== ev.end;
      const reinstate = existing.status === 'cancelled' && existing.ota_removed_at;
      if (existing.status === 'cancelled' && !reinstate) continue;
      if (!datesChanged && !reinstate && existing.ota_event_uid === ev.uid) continue;

      const { rows } = await query(
        `UPDATE reservations SET
           check_in = $2::date, check_out = $3::date, nights = $4,
           ota_event_uid = $5,
           ota_reservation_code = COALESCE($6, ota_reservation_code),
           ota_phone_last4 = COALESCE($7, ota_phone_last4),
           status = CASE WHEN $8 THEN 'confirmed' ELSE status END,
           ota_removed_at = CASE WHEN $8 THEN NULL ELSE ota_removed_at END,
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [existing.id, ev.start, ev.end, nightsBetween(ev.start, ev.end), ev.uid, details.code, details.last4, Boolean(reinstate)]
      );
      await resyncReservationBlocks(datesChanged ? existing : null, rows[0]);
      result.updated += 1;
      continue;
    }

    if (await hasConflict(feed, feed.unit_id, ev.start, ev.end)) {
      result.skipped += 1;
      continue;
    }

    if (createdBy == null) createdBy = await systemStaffId();
    if (createdBy == null) {
      console.warn('[ota-ical] no admin account to own imported reservations');
      return result;
    }

    const { rows } = await query(
      `INSERT INTO reservations (
         unit_id, guest_name, check_in, check_out, nights, total_amount, amount_paid,
         payment_status, booking_source, status, notes, adults, created_by,
         ota_feed_id, ota_event_uid, ota_reservation_code, ota_phone_last4
       ) VALUES ($1,$2,$3::date,$4::date,$5,0,0,'pending',$6,'confirmed',$7,1,$8,$9,$10,$11,$12)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        feed.unit_id,
        `${label} guest`,
        ev.start,
        ev.end,
        nightsBetween(ev.start, ev.end),
        label,
        placeholderNotes(label, details),
        createdBy,
        feed.id,
        ev.uid,
        details.code,
        details.last4,
      ]
    );
    if (!rows[0]) continue;
    await syncBlocksForReservation(rows[0]);
    result.created += 1;
    await notifyAdmins({
      type: 'ota_reservation',
      title: `New ${label} booking`,
      message: `${unitTitle} · ${ev.start} → ${ev.end} — add the guest name, phone and amount`,
      reservationId: rows[0].id,
    });
  }

  const liveUids = new Set(events.map((e) => e.uid));
  for (const r of imported) {
    if (seen.has(r.id) || liveUids.has(r.ota_event_uid)) continue;
    if (!['confirmed', 'pending'].includes(r.status) || r.check_in < today) continue;
    const { rows } = await query(
      `UPDATE reservations
       SET status = 'cancelled', ota_removed_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [r.id]
    );
    await syncBlocksForReservation(rows[0]);
    result.cancelled += 1;
    await notifyAdmins({
      type: 'ota_reservation_cancelled',
      title: `${label} booking cancelled`,
      message: `${unitTitle} · ${r.check_in} → ${r.check_out} was removed from the ${label} calendar`,
      reservationId: r.id,
    });
  }

  return result;
}

/** Run imports for several feeds; Airbnb first so Booking.com echoes of Airbnb stays are recognised. */
async function importReservationsForFeeds(items) {
  const totals = { created: 0, updated: 0, cancelled: 0, skipped: 0 };
  const ordered = [...items].sort(
    (a, b) => (PLATFORM_ORDER[a.feed.platform] ?? 9) - (PLATFORM_ORDER[b.feed.platform] ?? 9)
  );
  for (const { feed, ics } of ordered) {
    try {
      const r = await importFeedReservations(feed, ics);
      for (const k of Object.keys(totals)) totals[k] += r[k];
    } catch (err) {
      console.warn('[ota-ical] reservation import failed', feed.platform, feed.unit_slug, err.message);
    }
  }
  return totals;
}

module.exports = {
  parseIcalEvents,
  isReservationEvent,
  airbnbDetails,
  importFeedReservations,
  importReservationsForFeeds,
};
