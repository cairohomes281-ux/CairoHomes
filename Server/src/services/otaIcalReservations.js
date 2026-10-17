const { query } = require('../config/db');
const { syncBlocksForReservation, resyncReservationBlocks } = require('../lib/reservationBlocks');
const { notifyStaff } = require('./pmsNotifications');

const OUTSIDE_LABEL = 'Outside Channel';
const OUTSIDE_GUEST = 'Outside Channel guest';
const PLATFORM_LABELS = {
  airbnb: OUTSIDE_LABEL,
  booking: OUTSIDE_LABEL,
  travigo: OUTSIDE_LABEL,
  other: OUTSIDE_LABEL,
};
const PLATFORM_SYNC_RANK = { airbnb: 0, booking: 1, travigo: 2, other: 3 };
const PLACEHOLDER_NAMES = new Set(['airbnb guest', 'booking.com guest', 'outside channel guest']);
const NON_RESERVATION_BLOCK_SOURCES = ['reservation', 'reservation_import', 'booking'];

function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Business "today" in Cairo — used so a cancel overnight is not skipped on UTC servers. */
function todayIsoBusiness(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Match a live iCal event to an imported stay.
 * Only fall back to the same dates when the stay has no UID yet — never attach a
 * different UID (e.g. Airbnb "Not available" after a cancel) to an existing stay,
 * or the cancel loop will think the booking is still live.
 */
function matchImportedStay(imported, event, seenIds) {
  if (!event?.uid) return null;
  const byUid = imported.find((r) => r.ota_event_uid === event.uid && !seenIds.has(r.id));
  if (byUid) return byUid;
  return (
    imported.find(
      (r) =>
        !seenIds.has(r.id) &&
        !r.ota_event_uid &&
        r.check_in === event.start &&
        r.check_out === event.end
    ) || null
  );
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

function airbnbDetails(description) {
  const text = String(description || '');
  const code =
    /reservations\/details\/([A-Z0-9]+)/i.exec(text)?.[1] || /\b(HM[A-Z0-9]{6,})\b/.exec(text)?.[1] || null;
  const last4 = /last\s*4\s*digits\)?\s*:\s*(\d{4})/i.exec(text)?.[1] || null;
  return { code: code ? code.toUpperCase() : null, last4 };
}

/**
 * Airbnb guest bookings (Reserved / reservation URL / confirmation code).
 * Matching is UID-only, so a later "Not available" event never reattaches to a
 * cancelled Reserved stay.
 */
function isReservationEvent(platform, event) {
  if (platform !== 'airbnb' || !event?.start || !event?.end) return false;
  const summary = String(event.summary || '').trim().toLowerCase();
  const description = String(event.description || '');
  if (/not\s*available|unavailable|blocked|closed/.test(summary)) return false;
  if (airbnbDetails(description).code) return true;
  if (/reservations\/details\//i.test(description)) return true;
  if (summary === 'reserved' || summary.startsWith('reserved ')) return true;
  if (/airbnb\.com\/.*reservation/i.test(description)) return true;
  return false;
}

/** Airbnb host / cross-channel busy blocks (often Booking.com mirrored on Airbnb). */
function isAirbnbBusyBlockEvent(platform, event) {
  if (platform !== 'airbnb' || !event?.start || !event?.end) return false;
  if (isReservationEvent(platform, event)) return false;
  const summary = String(event.summary || '').trim().toLowerCase();
  return /not\s*available|unavailable|blocked|closed/.test(summary);
}

/** Booking.com / Travigo / other iCal busy events → Outside Channel stays. */
function isGenericOtaBusyEvent(platform, event) {
  if (!event?.start || !event?.end) return false;
  if (!PLATFORM_LABELS[platform] || platform === 'airbnb') return false;
  // These feeds only publish busy ranges (CLOSED / reserved / blocked).
  return true;
}

/** Events that should become Outside Channel stays on the PMS. */
function isImportableEvent(platform, event) {
  if (!event?.start || !event?.end || !PLATFORM_LABELS[platform]) return false;
  if (platform === 'airbnb') {
    return isReservationEvent(platform, event) || isAirbnbBusyBlockEvent(platform, event);
  }
  return isGenericOtaBusyEvent(platform, event);
}

/**
 * UIDs we invent locally (Schedule fill bars). They never appear on an OTA ICS,
 * so the cancel loop must not treat "missing from ICS" as a channel cancel.
 */
function isLocalOtaUid(uid) {
  const value = String(uid || '');
  if (!value) return false;
  if (value.startsWith('schedule-block:')) return true;
  if (value.startsWith('dismissed:')) return true;
  if (value.startsWith('stay:')) return true;
  const parent = splitParentUid(value);
  if (parent && isLocalOtaUid(parent)) return true;
  return false;
}

function channelNotes(platform, label, details, reserved) {
  if (platform === 'airbnb' && reserved) return placeholderNotes(label, details);
  if (platform === 'booking') {
    return 'Imported from the Booking.com calendar. Add the guest name, phone and amount — or dismiss if it is only a closed block.';
  }
  if (platform === 'airbnb') {
    return `Blocked on the Airbnb calendar (often another OTA). Add the guest name, phone and amount — or dismiss if it is only a host block.`;
  }
  return `Imported from the ${label} calendar. Add the guest name, phone and amount — or dismiss if it is only a closed block.`;
}

function nightsBetween(checkIn, checkOut) {
  return Math.max(1, Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000));
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function isOtaBookingSource(source) {
  const value = String(source || '').trim().toLowerCase();
  return (
    value === 'outside channel' ||
    value === 'airbnb' ||
    value === 'booking.com' ||
    value === 'booking' ||
    value === 'bookingcom'
  );
}

function isPlaceholderGuest(name) {
  return PLACEHOLDER_NAMES.has(String(name || '').trim().toLowerCase());
}

function isUnfilledOtaStay(row) {
  if (!row || row.status === 'cancelled' || !isOtaBookingSource(row.booking_source)) return false;
  if (!row.ota_event_uid) return false;
  const name = String(row.guest_name || '').trim().toLowerCase();
  const phone = String(row.guest_phone || '').trim();
  const total = Number(row.total_amount) || 0;
  return total <= 0 || !phone || isPlaceholderGuest(name) || name === '';
}

/** Nights the staff did not assign to this stay, still inside the original block. */
function leftoverRanges(spanStart, spanEnd, start, end) {
  const ranges = [];
  if (start > spanStart) ranges.push([spanStart, start]);
  if (end < spanEnd) ranges.push([end, spanEnd]);
  return ranges;
}

/**
 * A blocked span can hide more than one stay (21–22 and 23–24 inside 21–25).
 * The confirmed dates must sit inside that span. Leftover nights become another stay.
 */
function confirmStayDates(spanIn, spanOut, stayIn, stayOut) {
  const spanStart = isoDate(spanIn);
  const spanEnd = isoDate(spanOut);
  const start = isoDate(stayIn) || spanStart;
  const end = isoDate(stayOut) || spanEnd;
  if (!spanStart || !spanEnd || !start || !end) return { error: 'Check-in and check-out are required' };
  if (!(start < end)) return { error: 'Check-out must be after check-in' };
  if (start < spanStart || end > spanEnd) {
    return { error: 'Keep the dates inside the blocked nights. Leave the other nights for the next reservation.' };
  }
  return { spanStart, spanEnd, start, end, leftovers: leftoverRanges(spanStart, spanEnd, start, end) };
}

function splitEventUid(parentUid, checkIn, checkOut) {
  return `split:${encodeURIComponent(String(parentUid))}:${checkIn}:${checkOut}`;
}

function splitParentUid(uid) {
  const value = String(uid || '');
  if (!value.startsWith('split:')) return null;
  const parts = value.slice(6).split(':');
  if (parts.length < 3) return null;
  parts.pop();
  parts.pop();
  try {
    return decodeURIComponent(parts.join(':'));
  } catch {
    return null;
  }
}

function rangesOverlap(a, b) {
  const aIn = a.check_in || a.ci;
  const aOut = a.check_out || a.co;
  const bIn = b.check_in || b.ci;
  const bOut = b.check_out || b.co;
  return aIn < bOut && aOut > bIn;
}

/** When both calendars describe the same nights, keep one stay and drop the echo. */
function stayToCancel(a, b) {
  if (!rangesOverlap(a, b)) return null;
  const aOpen = isUnfilledOtaStay(a);
  const bOpen = isUnfilledOtaStay(b);
  if (!aOpen && !bOpen) return null;
  if (aOpen && !bOpen) return a;
  if (bOpen && !aOpen) return b;
  const aAirbnb = String(a.booking_source || '').trim().toLowerCase() === 'airbnb';
  const bAirbnb = String(b.booking_source || '').trim().toLowerCase() === 'airbnb';
  if (aAirbnb && !bAirbnb) return b;
  if (bAirbnb && !aAirbnb) return a;
  return String(a.check_in || a.ci) > String(b.check_in || b.ci) ? a : b;
}

async function collapseOverlappingOtaStays() {
  const { rows } = await query(
    `SELECT id, unit_id, guest_name, guest_phone, total_amount::float AS total_amount,
            check_in::text AS check_in, check_out::text AS check_out,
            booking_source, ota_event_uid, status
     FROM reservations
     WHERE status <> 'cancelled'
       AND ota_event_uid IS NOT NULL
       AND check_out >= CURRENT_DATE - 1
       AND lower(trim(booking_source)) IN ('outside channel', 'airbnb', 'booking.com', 'booking', 'bookingcom')`
  );
  const byUnit = new Map();
  for (const row of rows) {
    if (!byUnit.has(row.unit_id)) byUnit.set(row.unit_id, []);
    byUnit.get(row.unit_id).push(row);
  }
  let cancelled = 0;
  for (const list of byUnit.values()) {
    const dropped = new Set();
    for (let i = 0; i < list.length; i += 1) {
      if (dropped.has(list[i].id)) continue;
      for (let j = i + 1; j < list.length; j += 1) {
        if (dropped.has(list[j].id)) continue;
        const loser = stayToCancel(list[i], list[j]);
        if (loser) dropped.add(loser.id);
      }
    }
    for (const id of dropped) {
      const { rows: updated } = await query(
        `UPDATE reservations
         SET status = 'cancelled',
             notes = btrim(COALESCE(notes, '') || ' Cancelled because these nights are already on the other calendar.'),
             updated_at = now()
         WHERE id = $1 AND status <> 'cancelled'
         RETURNING *`,
        [id]
      );
      if (!updated[0]) continue;
      await syncBlocksForReservation(updated[0]);
      cancelled += 1;
    }
  }
  return cancelled;
}

async function systemStaffId() {
  const { rows } = await query(
    `SELECT id FROM staff_users WHERE role = 'admin' ORDER BY is_active DESC, id LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

async function hasConflict(feed, unitId, checkIn, checkOut) {
  // Only active stays block new imports. Staff dismiss/DELETE tombstones
  // (cancelled, ota_removed_at NULL) must not permanently block a rebook UID;
  // same-UID dismiss is handled by matchImportedStay + reinstate rules.
  const { rows } = await query(
    `SELECT 1 FROM reservations
     WHERE unit_id = $1
       AND check_in < $3::date AND check_out > $2::date
       AND status IS DISTINCT FROM 'cancelled'
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

async function icalNightsStillBusy(wpPostId, feedId, checkIn, checkOut) {
  if (!wpPostId || !checkIn || !checkOut) return false;
  const { rows } = await query(
    `SELECT 1 FROM unit_ical_blocks
     WHERE wp_post_id = $1
       AND feed_id = $2
       AND date >= $3::date
       AND date < $4::date
     LIMIT 1`,
    [wpPostId, feedId, checkIn, checkOut]
  );
  return Boolean(rows[0]);
}

/**
 * Create, update or cancel placeholder reservations for one feed's iCal events.
 * Only stays that end today or later are touched.
 */
async function importFeedReservations(feed, ics) {
  const label = PLATFORM_LABELS[feed.platform];
  const result = { created: 0, updated: 0, cancelled: 0, skipped: 0 };
  if (!label || !feed.unit_id || !/END:VCALENDAR/i.test(String(ics || ''))) return result;

  const today = todayIsoBusiness();
  const allEvents = parseIcalEvents(ics).filter(
    (e) => e.uid && e.start && e.end && e.end > e.start
  );
  // Prefer Reserved first, then Not available / Booking echoes — UID-only match
  // so a cancel never reuses a different event's UID.
  const upcoming = allEvents
    .filter((e) => e.end > today && isImportableEvent(feed.platform, e))
    .sort((a, b) => {
      const aRes = isReservationEvent(feed.platform, a) ? 0 : 1;
      const bRes = isReservationEvent(feed.platform, b) ? 0 : 1;
      return aRes - bRes || String(a.start).localeCompare(String(b.start));
    });
  const liveUids = new Set(allEvents.map((e) => e.uid));
  const unitTitle = feed.unit_title || feed.unit_slug || 'unit';

  const { rows: imported } = await query(
    `SELECT id, unit_id, status, check_in::text AS check_in, check_out::text AS check_out,
            ota_event_uid, ota_removed_at, COALESCE(ota_dates_locked, false) AS ota_dates_locked
     FROM reservations
     WHERE ota_feed_id = $1
        OR (unit_id = $2 AND ota_event_uid IS NOT NULL AND ota_feed_id IS NULL)`,
    [feed.id, feed.unit_id]
  );
  const seen = new Set();
  let createdBy = null;

  for (const ev of upcoming) {
    const details = feed.platform === 'airbnb' ? airbnbDetails(ev.description) : { code: null, last4: null };
    const existing = matchImportedStay(imported, ev, seen);
    const reserved = isReservationEvent(feed.platform, ev);
    const notes = channelNotes(feed.platform, label, details, reserved);

    if (existing) {
      seen.add(existing.id);
      if (existing.ota_dates_locked) continue;
      const datesChanged = existing.check_in !== ev.start || existing.check_out !== ev.end;
      const reinstate = existing.status === 'cancelled' && existing.ota_removed_at;
      if (existing.status === 'cancelled' && !reinstate) continue;
      if (!datesChanged && !reinstate && existing.ota_event_uid === ev.uid) continue;

      const { rows } = await query(
        `UPDATE reservations SET
           check_in = $2::date, check_out = $3::date, nights = $4,
           ota_event_uid = $5,
           ota_feed_id = COALESCE(ota_feed_id, $9),
           ota_reservation_code = COALESCE($6, ota_reservation_code),
           ota_phone_last4 = COALESCE($7, ota_phone_last4),
           status = CASE WHEN $8 THEN 'confirmed' ELSE status END,
           ota_removed_at = CASE WHEN $8 THEN NULL ELSE ota_removed_at END,
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [
          existing.id,
          ev.start,
          ev.end,
          nightsBetween(ev.start, ev.end),
          ev.uid,
          details.code,
          details.last4,
          Boolean(reinstate),
          feed.id,
        ]
      );
      if (!rows[0]) continue;
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

    const { rows: byUid } = await query(
      `SELECT id, status, ota_removed_at, check_in::text AS check_in, check_out::text AS check_out
       FROM reservations
       WHERE ota_feed_id = $1 AND ota_event_uid = $2
       LIMIT 1`,
      [feed.id, ev.uid]
    );
    if (byUid[0]) {
      const row = byUid[0];
      seen.add(row.id);
      const dismissed = row.status === 'cancelled' && !row.ota_removed_at;
      if (dismissed) {
        result.skipped += 1;
        continue;
      }
      const reinstate = row.status === 'cancelled' && row.ota_removed_at;
      const { rows } = await query(
        `UPDATE reservations SET
           check_in = $2::date, check_out = $3::date, nights = $4,
           status = CASE WHEN $5 THEN 'confirmed' ELSE status END,
           ota_removed_at = CASE WHEN $5 THEN NULL ELSE ota_removed_at END,
           ota_reservation_code = COALESCE($6, ota_reservation_code),
           ota_phone_last4 = COALESCE($7, ota_phone_last4),
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          row.id,
          ev.start,
          ev.end,
          nightsBetween(ev.start, ev.end),
          Boolean(reinstate),
          details.code,
          details.last4,
        ]
      );
      if (rows[0]) {
        await resyncReservationBlocks(
          row.check_in !== ev.start || row.check_out !== ev.end ? row : null,
          rows[0]
        );
        result.updated += 1;
      }
      continue;
    }

    const { rows } = await query(
      `INSERT INTO reservations (
         unit_id, guest_name, check_in, check_out, nights, total_amount, amount_paid,
         payment_status, booking_source, status, notes, adults, created_by,
         ota_feed_id, ota_event_uid, ota_reservation_code, ota_phone_last4,
         currency, exchange_rate
       ) VALUES ($1,$2,$3::date,$4::date,$5,0,0,$13,$6,'confirmed',$7,1,$8,$9,$10,$11,$12,'USD',1)
       RETURNING *`,
      [
        feed.unit_id,
        OUTSIDE_GUEST,
        ev.start,
        ev.end,
        nightsBetween(ev.start, ev.end),
        OUTSIDE_LABEL,
        notes,
        createdBy,
        feed.id,
        ev.uid,
        details.code,
        details.last4,
        'pending',
      ]
    );
    if (!rows[0]) {
      result.skipped += 1;
      continue;
    }
    await syncBlocksForReservation(rows[0]);
    result.created += 1;
    seen.add(rows[0].id);
    await notifyAdmins({
      type: 'ota_reservation',
      title: `New ${label} booking`,
      message: `${unitTitle} · ${ev.start} → ${ev.end} — add the guest name, phone and amount`,
      reservationId: rows[0].id,
    });
  }

  for (const r of imported) {
    if (seen.has(r.id)) continue;
    if (!r.ota_event_uid) continue;
    if (String(r.status || '').toLowerCase() === 'cancelled') continue;
    if (!(r.check_out > today)) continue;

    if (isLocalOtaUid(r.ota_event_uid)) {
      // Schedule-filled stays: cancel only when Airbnb opened every night in the span.
      if (await icalNightsStillBusy(feed.wp_post_id, feed.id, r.check_in, r.check_out)) {
        continue;
      }
    } else {
      if (liveUids.has(r.ota_event_uid)) continue;
      const parentUid = splitParentUid(r.ota_event_uid);
      if (parentUid && liveUids.has(parentUid)) continue;
    }

    const { rows } = await query(
      `UPDATE reservations
       SET status = 'cancelled', ota_removed_at = now(), updated_at = now()
       WHERE id = $1 AND status IS DISTINCT FROM 'cancelled'
       RETURNING *`,
      [r.id]
    );
    if (!rows[0]) continue;
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

/**
 * Lock the stay the staff just confirmed, and open a new Outside Channel stay
 * for any nights in the original block that they left out.
 */
async function finalizeOutsideChannelSplit({
  reservationId,
  unitId,
  spanIn,
  spanOut,
  stayIn,
  stayOut,
  feedId = null,
  parentUid = null,
  createdBy = null,
}) {
  const confirmed = confirmStayDates(spanIn, spanOut, stayIn, stayOut);
  if (confirmed.error) {
    const err = new Error(confirmed.error);
    err.status = 400;
    throw err;
  }
  const parent = parentUid || `stay:${reservationId || unitId}`;
  if (reservationId) {
    // Keep Airbnb / Booking.com channel flags; only lock dates + attach UID for cancel sync.
    await query(
      `UPDATE reservations
       SET ota_dates_locked = true,
           ota_event_uid = COALESCE(NULLIF(ota_event_uid, ''), $2),
           ota_feed_id = COALESCE(ota_feed_id, $3),
           updated_at = now()
       WHERE id = $1`,
      [reservationId, parent, feedId]
    );
  }
  for (const [checkIn, checkOut] of confirmed.leftovers) {
    const uid = splitEventUid(parent, checkIn, checkOut);
    const { rows: already } = await query(
      `SELECT id FROM reservations
       WHERE unit_id = $1 AND status <> 'cancelled'
         AND ($5::int IS NULL OR id <> $5)
         AND (ota_event_uid = $2 OR (check_in < $4::date AND check_out > $3::date))
       LIMIT 1`,
      [unitId, uid, checkIn, checkOut, reservationId || null]
    );
    if (already[0] || !createdBy) continue;
    const { rows } = await query(
      `INSERT INTO reservations (
         unit_id, guest_name, check_in, check_out, nights, total_amount, amount_paid,
         payment_status, booking_source, status, notes, adults, created_by,
         ota_feed_id, ota_event_uid, currency, exchange_rate
       ) VALUES ($1,$2,$3::date,$4::date,$5,0,0,'pending',$6,'confirmed',$7,1,$8,$9,$10,'USD',1)
       RETURNING *`,
      [
        unitId,
        OUTSIDE_GUEST,
        checkIn,
        checkOut,
        nightsBetween(checkIn, checkOut),
        OUTSIDE_LABEL,
        'Nights left from an Outside Channel block. Add the guest name, phone and price.',
        createdBy,
        feedId,
        uid,
      ]
    );
    if (rows[0]) await syncBlocksForReservation(rows[0]);
  }
  return confirmed;
}

/** Import every linked OTA calendar (Airbnb, Booking.com, …). Airbnb first so overlaps collapse cleanly. */
async function importReservationsForFeeds(items) {
  const totals = { created: 0, updated: 0, cancelled: 0, skipped: 0 };
  const ordered = items
    .filter((item) => PLATFORM_LABELS[item?.feed?.platform])
    .sort(
      (a, b) =>
        (PLATFORM_SYNC_RANK[a.feed.platform] ?? 9) - (PLATFORM_SYNC_RANK[b.feed.platform] ?? 9)
    );
  for (const { feed, ics } of ordered) {
    try {
      const r = await importFeedReservations(feed, ics);
      for (const k of Object.keys(totals)) totals[k] += r[k];
    } catch (err) {
      console.warn('[ota-ical] reservation import failed', feed.platform, feed.unit_slug, err.message);
    }
  }
  try {
    totals.cancelled += await collapseOverlappingOtaStays();
  } catch (err) {
    console.warn('[ota-ical] overlap cleanup failed', err.message);
  }
  return totals;
}

module.exports = {
  parseIcalEvents,
  isReservationEvent,
  isAirbnbBusyBlockEvent,
  isGenericOtaBusyEvent,
  isImportableEvent,
  isLocalOtaUid,
  airbnbDetails,
  stayToCancel,
  confirmStayDates,
  splitParentUid,
  matchImportedStay,
  finalizeOutsideChannelSplit,
  importFeedReservations,
  importReservationsForFeeds,
  OUTSIDE_LABEL,
  OUTSIDE_GUEST,
  isPlaceholderGuest,
  PLATFORM_LABELS,
};
