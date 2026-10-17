/**
 * Outbound iCal (PMS → Airbnb / Booking.com import calendars).
 *
 * Airbnb pulls this feed; we cannot push. Busy VEVENTs close nights.
 * When a PMS stay is cancelled, keep the same UID with STATUS:CANCELLED and
 * move the event into the past so Airbnb updates the imported row instead of
 * leaving an orphan "unattributed" block on the original dates.
 */

const CANCEL_TOMBSTONE_DAYS = 45;

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

function yyyymmdd(iso) {
  return String(iso || '').replace(/-/g, '').slice(0, 8);
}

function utcStamp(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIsoBusiness(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function foldLine(line) {
  const text = String(line);
  if (text.length <= 75) return text;
  const parts = [];
  parts.push(text.slice(0, 75));
  let i = 75;
  while (i < text.length) {
    parts.push(` ${text.slice(i, i + 74)}`);
    i += 74;
  }
  return parts.join('\r\n');
}

/**
 * Build VEVENT objects for the export feed.
 * @param {{
 *   unit: { id: string, slug?: string },
 *   bookings?: Array<{ id: string|number, checkin: string, checkout: string }>,
 *   reservations?: Array<{
 *     id: string|number,
 *     check_in: string,
 *     check_out: string,
 *     status?: string,
 *     updated_at?: string|Date,
 *     ota_event_uid?: string|null,
 *   }>,
 *   blockedDates?: string[],
 *   now?: Date,
 * }} input
 */
function buildExportEvents(input) {
  const now = input.now || new Date();
  const today = todayIsoBusiness(now);
  const tombstoneCutoff = addDaysIso(today, -CANCEL_TOMBSTONE_DAYS);
  const events = [];

  for (const b of input.bookings || []) {
    const start = isoDate(b.checkin);
    const end = isoDate(b.checkout);
    if (!start || !end || !(start < end)) continue;
    if (end <= today) continue;
    events.push({
      uid: `book-${b.id}@cairohomes.com`,
      start,
      end,
      summary: 'Booked',
      status: 'CONFIRMED',
      sequence: 1,
      stamp: utcStamp(now),
    });
  }

  for (const r of input.reservations || []) {
    if (r.ota_event_uid) continue; // Airbnb already owns these nights
    const start = isoDate(r.check_in);
    const end = isoDate(r.check_out);
    if (!start || !end || !(start < end)) continue;
    const cancelled = String(r.status || '').toLowerCase() === 'cancelled';
    const uid = `res-${r.id}@cairohomes.com`;
    const stamp = utcStamp(r.updated_at ? new Date(r.updated_at) : now);
    // Bump SEQUENCE from updated_at so Airbnb/Booking refresh date changes.
    const sequence = r.updated_at
      ? Math.max(1, Math.floor(new Date(r.updated_at).getTime() / 60000) % 1000000)
      : 1;

    if (cancelled) {
      // Keep UID visible so Airbnb updates the imported event off the stay dates.
      const updatedDay = isoDate(r.updated_at) || today;
      if (updatedDay < tombstoneCutoff) continue;
      events.push({
        uid,
        start: '1970-01-01',
        end: '1970-01-02',
        summary: 'Cancelled',
        status: 'CANCELLED',
        sequence: Math.max(2, sequence + 1),
        stamp,
      });
      continue;
    }

    if (end <= today) continue;
    events.push({
      uid,
      start,
      end,
      summary: 'Booked',
      status: 'CONFIRMED',
      sequence,
      stamp,
    });
  }

  // Collapse manual/owner holds into DATE ranges (DTEND exclusive).
  const nights = [...new Set((input.blockedDates || []).map(isoDate).filter(Boolean))]
    .filter((d) => d >= today)
    .sort();
  let rangeStart = null;
  let rangeEnd = null;
  const flush = () => {
    if (!rangeStart) return;
    events.push({
      uid: `block-${input.unit.id}-${yyyymmdd(rangeStart)}-${yyyymmdd(rangeEnd)}@cairohomes.com`,
      start: rangeStart,
      end: rangeEnd,
      summary: 'Blocked',
      status: 'CONFIRMED',
      sequence: 0,
      stamp: utcStamp(now),
    });
    rangeStart = null;
    rangeEnd = null;
  };
  for (const d of nights) {
    if (!rangeStart) {
      rangeStart = d;
      rangeEnd = addDaysIso(d, 1);
      continue;
    }
    if (d === rangeEnd) {
      rangeEnd = addDaysIso(d, 1);
    } else {
      flush();
      rangeStart = d;
      rangeEnd = addDaysIso(d, 1);
    }
  }
  flush();

  return events;
}

function renderExportIcs(events, { calendarName = 'Cairo Homes' } = {}) {
  const stamp = utcStamp();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cairo Homes Hospitality Channel Manager//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${calendarName}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];

  for (const ev of events || []) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${ev.stamp || stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${yyyymmdd(ev.start)}`);
    lines.push(`DTEND;VALUE=DATE:${yyyymmdd(ev.end)}`);
    lines.push(`SUMMARY:${ev.summary || 'Booked'}`);
    lines.push(`STATUS:${ev.status || 'CONFIRMED'}`);
    lines.push(`SEQUENCE:${Number(ev.sequence) || 0}`);
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

module.exports = {
  CANCEL_TOMBSTONE_DAYS,
  buildExportEvents,
  renderExportIcs,
  isoDate,
  todayIsoBusiness,
};
