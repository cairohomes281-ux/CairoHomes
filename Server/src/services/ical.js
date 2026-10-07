const { pool, query } = require('../config/db');
const { icalSourceForPlatform } = require('../lib/otaPlatforms');
const { GUEST_AVAILABILITY_MONTHS } = require('../lib/calendarOccupancy');

const FEED_TIMEOUT_MS = 20000;
const CONCURRENCY = 8;
const MONTHS_AHEAD = GUEST_AVAILABILITY_MONTHS;
const MAX_REDIRECTS = 5;

function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localIso(d);
}

function ymd(s) {
  const digits = String(s || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length !== 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** Extract YYYYMMDD from DATE or DATE-TIME (local/Z) values. */
function extractYmdToken(raw) {
  const m = /([0-9]{8})(?:T[0-9]{6}Z?)?/.exec(String(raw || ''));
  return m ? ymd(m[1]) : null;
}

function looksLikeIcal(text) {
  return /BEGIN:VCALENDAR/i.test(String(text || ''));
}

function parseIcalBusyDates(ics, fromIso, toIso) {
  const dates = new Set();
  const normalized = String(ics || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '');
  const events = normalized.split(/BEGIN:VEVENT/i);
  const toExcl = toIso || '9999-12-31';
  const from = fromIso || '1970-01-01';

  for (const ev of events.slice(1)) {
    const startMatch = /DTSTART[^:]*:([^\r\n]+)/i.exec(ev);
    const endMatch = /DTEND[^:]*:([^\r\n]+)/i.exec(ev);
    if (!startMatch) continue;
    const start = extractYmdToken(startMatch[1]);
    if (!start) continue;
    const end = endMatch ? extractYmdToken(endMatch[1]) : addDaysIso(start, 1);
    if (!end) continue;
    const walkStart = start > from ? start : from;
    const walkEnd = end < toExcl ? end : toExcl;
    for (let d = new Date(`${walkStart}T00:00:00`); localIso(d) < walkEnd; d.setDate(d.getDate() + 1)) {
      dates.add(localIso(d));
    }
  }
  return [...dates];
}

async function fetchWithTimeout(url, ms = FEED_TIMEOUT_MS) {
  const { assertValidIcalUrl } = require('../lib/otaPlatforms');
  let current = assertValidIcalUrl(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        signal: ctrl.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'CairoHomes-ChannelManager/1.0',
          Accept: 'text/calendar, text/plain, */*',
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new Error(`HTTP ${res.status} redirect without Location`);
        const next = new URL(loc, current).toString();
        assertValidIcalUrl(next);
        current = next;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!looksLikeIcal(text)) {
        throw new Error('Remote response is not a valid iCalendar feed');
      }
      return text;
    }
    throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
  } finally {
    clearTimeout(t);
  }
}

async function getEnabledOtaFeeds({ unitId = null } = {}) {
  const params = [];
  let filter = '';
  if (unitId) {
    filter = 'AND f.unit_id = $1';
    params.push(unitId);
  }
  const { rows } = await query(
    `SELECT f.id, f.unit_id, f.wp_post_id, f.platform, f.label, f.ical_url, f.enabled,
            f.external_listing_id, f.sync_status, f.last_sync_at, f.last_sync_error, f.updated_at,
            u.slug AS unit_slug, u.title AS unit_title, u.status AS unit_status
     FROM unit_ota_feeds f
     JOIN units u ON u.id = f.unit_id
     WHERE f.enabled = true
       AND f.ical_url IS NOT NULL AND f.ical_url <> ''
       AND u.status = 'published'
       ${filter}
     ORDER BY u.title NULLS LAST, f.platform`,
    params
  );
  return rows;
}

async function poolMap(items, concurrency, fn) {
  let i = 0;
  const n = Math.min(concurrency, items.length || 1);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        await fn(items[idx]);
      }
    })
  );
}

async function importReservations(items) {
  const { importReservationsForFeeds } = require('./otaIcalReservations');
  return importReservationsForFeeds(items);
}

async function refreshFeedBlocks(feed, { from, to }) {
  const { count, text } = await syncFeedBlocks(feed, { from, to });
  await importReservations([{ feed, ics: text }]);
  return count;
}

async function syncFeedBlocks(feed, { from, to }) {
  const text = await fetchWithTimeout(feed.ical_url);
  if (!looksLikeIcal(text)) {
    throw new Error('Remote response is not a valid iCalendar feed');
  }
  const dates = parseIcalBusyDates(text, from, to);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM unit_ical_blocks
       WHERE feed_id = $1 AND date >= $2 AND date < $3`,
      [feed.id, from, to]
    );
    for (const date of dates) {
      await client.query(
        `INSERT INTO unit_ical_blocks (feed_id, wp_post_id, platform, date, updated_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (feed_id, date) DO UPDATE SET updated_at = now(), platform = EXCLUDED.platform`,
        [feed.id, feed.wp_post_id, feed.platform, date]
      );
    }
    await client.query(
      `UPDATE unit_ota_feeds
       SET last_sync_at = now(),
           last_sync_error = NULL,
           sync_status = 'connected',
           updated_at = now()
       WHERE id = $1`,
      [feed.id]
    );
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
  return { count: dates.length, text };
}

async function refreshIcalBlocks({ monthsAhead = MONTHS_AHEAD, unitId = null } = {}) {
  const today = new Date();
  const from = localIso(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const toDate = new Date(today.getFullYear(), today.getMonth() + monthsAhead, today.getDate());
  const to = localIso(toDate);

  const feeds = await getEnabledOtaFeeds({ unitId });

  let datesWritten = 0;
  let errors = 0;
  const feedErrors = [];
  const fetched = [];

  await poolMap(feeds, CONCURRENCY, async (feed) => {
    try {
      await query(
        `UPDATE unit_ota_feeds SET sync_status = 'syncing', updated_at = now() WHERE id = $1`,
        [feed.id]
      );
      const { count, text } = await syncFeedBlocks(feed, { from, to });
      datesWritten += count;
      fetched.push({ feed, ics: text });
    } catch (err) {
      errors++;
      feedErrors.push({ feed_id: feed.id, platform: feed.platform, error: err.message });
      await query(
        `UPDATE unit_ota_feeds
         SET last_sync_error = $2, sync_status = 'failed', updated_at = now()
         WHERE id = $1`,
        [feed.id, err.message]
      );
      console.warn('[ical] skip', feed.platform, feed.unit_slug, err.message);
    }
  });

  const reservations = await importReservations(fetched);

  return {
    feeds: feeds.length,
    datesWritten,
    errors,
    feedErrors,
    reservations,
    from,
    to,
  };
}

/** @deprecated legacy single-feed helper */
async function getIcalUrl(wpPostId) {
  const { rows } = await query(
    `SELECT ical_url FROM unit_ota_feeds
     WHERE wp_post_id = $1 AND enabled = true AND ical_url IS NOT NULL AND ical_url <> ''
     ORDER BY updated_at DESC
     LIMIT 1`,
    [wpPostId]
  );
  return rows[0]?.ical_url || null;
}

async function fetchUpstreamBusyDates(wpPostId, from, to) {
  const { rows: feeds } = await query(
    `SELECT id, wp_post_id, platform, ical_url
     FROM unit_ota_feeds
     WHERE wp_post_id = $1 AND enabled = true AND ical_url IS NOT NULL AND ical_url <> ''`,
    [wpPostId]
  );
  const dates = new Set();
  for (const feed of feeds) {
    try {
      const text = await fetchWithTimeout(feed.ical_url);
      for (const date of parseIcalBusyDates(text, from, to)) dates.add(date);
    } catch (err) {
      console.warn('[ical] upstream skip', feed.platform, err.message);
    }
  }
  return [...dates];
}

module.exports = {
  refreshIcalBlocks,
  parseIcalBusyDates,
  fetchUpstreamBusyDates,
  getIcalUrl,
  fetchWithTimeout,
  getEnabledOtaFeeds,
  refreshFeedBlocks,
  icalSourceForPlatform,
  looksLikeIcal,
  MONTHS_AHEAD,
};
