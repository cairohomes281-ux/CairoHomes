const { query, pool } = require('../config/db');
const { destroyCloudinaryUrl } = require('../config/cloudinary');

function retentionDays() {
  const n = Number(process.env.DATA_RETENTION_DAYS || 30);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

function isDryRun() {
  return /^(1|true|yes)$/i.test(String(process.env.DATA_RETENTION_DRY_RUN || ''));
}

function isEnabled() {
  
  const raw = process.env.DATA_RETENTION_ENABLED;
  if (raw == null || raw === '') return true;
  return !/^(0|false|no|off)$/i.test(String(raw));
}

function collectUrls(...sources) {
  const out = new Set();
  for (const src of sources) {
    if (!src) continue;
    if (Array.isArray(src)) {
      for (const u of src) {
        if (typeof u === 'string' && u.trim()) out.add(u.trim());
      }
    } else if (typeof src === 'string' && src.trim()) {
      out.add(src.trim());
    }
  }
  return out;
}

function urlsFromJsonPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const urls = [];
  if (Array.isArray(payload.photo_urls)) urls.push(...payload.photo_urls);
  if (Array.isArray(payload.id_photo_urls)) urls.push(...payload.id_photo_urls);
  if (payload.evidence_url) urls.push(payload.evidence_url);
  return urls.filter((u) => typeof u === 'string' && u.trim());
}

async function loadProtectedUnitMediaUrls() {
  const { rows } = await query(
    `SELECT cover_url, photo_urls
     FROM units
     WHERE cover_url IS NOT NULL
        OR (photo_urls IS NOT NULL AND cardinality(photo_urls) > 0)`
  );
  const protectedUrls = new Set();
  for (const row of rows) {
    if (row.cover_url) protectedUrls.add(String(row.cover_url).trim());
    if (Array.isArray(row.photo_urls)) {
      for (const u of row.photo_urls) {
        if (u) protectedUrls.add(String(u).trim());
      }
    }
  }
  return protectedUrls;
}

async function destroyGuestMedia(urls, protectedUrls) {
  const unique = [...new Set([...urls].map((u) => String(u).trim()).filter(Boolean))];
  let destroyed = 0;
  let skippedProtected = 0;
  let skippedOther = 0;

  for (const url of unique) {
    if (protectedUrls.has(url)) {
      skippedProtected += 1;
      continue;
    }
    if (isDryRun()) {
      destroyed += 1;
      continue;
    }
    const result = await destroyCloudinaryUrl(url);
    if (result.deleted) destroyed += 1;
    else if (result.reason === 'protected_folder' || result.reason === 'unit_media_protected') {
      skippedProtected += 1;
    } else {
      skippedOther += 1;
    }
  }

  return { destroyed, skippedProtected, skippedOther, considered: unique.length };
}


async function runDataRetentionCleanup() {
  if (!isEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }

  const days = retentionDays();
  const dryRun = isDryRun();
  const protectedUrls = await loadProtectedUnitMediaUrls();

  const { rows: reservations } = await query(
    `SELECT id, booking_id, id_photo_urls, transfer_proof_path, check_out
     FROM reservations
     WHERE check_out < (CURRENT_DATE - $1::int)
       AND (
         (id_photo_urls IS NOT NULL AND cardinality(id_photo_urls) > 0)
         OR transfer_proof_path IS NOT NULL
       )`,
    [days]
  );

  const reservationIds = reservations.map((r) => r.id);
  const bookingIdsFromReservations = reservations.map((r) => r.booking_id).filter(Boolean);

  const { rows: bookings } = await query(
    `SELECT id, id_photo_urls, checkout
     FROM bookings
     WHERE checkout < (CURRENT_DATE - $1::int)
       AND id_photo_urls IS NOT NULL
       AND cardinality(id_photo_urls) > 0`,
    [days]
  );
  const bookingIds = [...new Set([...bookings.map((b) => b.id), ...bookingIdsFromReservations])];

  const mediaUrls = collectUrls(
    ...reservations.map((r) => r.id_photo_urls),
    ...reservations.map((r) => r.transfer_proof_path),
    ...bookings.map((b) => b.id_photo_urls)
  );

  if (reservationIds.length || bookingIds.length) {
    const paymentParams = [];
    const paymentClauses = [];
    if (reservationIds.length) {
      paymentParams.push(reservationIds);
      paymentClauses.push(`reservation_id = ANY($${paymentParams.length}::int[])`);
    }
    if (bookingIds.length) {
      paymentParams.push(bookingIds);
      paymentClauses.push(`booking_id = ANY($${paymentParams.length}::uuid[])`);
    }
    if (paymentClauses.length) {
      const { rows: payments } = await query(
        `SELECT document_path FROM payments
         WHERE document_path IS NOT NULL AND (${paymentClauses.join(' OR ')})`,
        paymentParams
      );
      for (const p of payments) {
        if (p.document_path) mediaUrls.add(String(p.document_path).trim());
      }
    }
  }

  if (bookingIds.length) {
    const { rows: sessions } = await query(
      `SELECT payload FROM card_checkout_sessions
       WHERE booking_id = ANY($1::uuid[])`,
      [bookingIds]
    );
    for (const s of sessions) {
      for (const u of urlsFromJsonPayload(s.payload)) mediaUrls.add(u);
    }
  }

  
  const { rows: staleSessions } = await query(
    `SELECT id, payload FROM card_checkout_sessions
     WHERE created_at < (now() - ($1::int || ' days')::interval)
       AND (booking_id IS NULL OR status IN ('failed','expired','pending'))`,
    [days]
  );
  for (const s of staleSessions) {
    for (const u of urlsFromJsonPayload(s.payload)) mediaUrls.add(u);
  }

  const mediaResult = await destroyGuestMedia(mediaUrls, protectedUrls);

  if (dryRun) {
    return {
      dryRun: true,
      days,
      reservationsMatched: reservationIds.length,
      bookingsMatched: bookingIds.length,
      staleSessionsMatched: staleSessions.length,
      media: mediaResult,
      protectedUnitUrls: protectedUrls.size,
    };
  }

  const client = await pool.connect();
  let scrubbedReservations = 0;
  let scrubbedBookings = 0;
  let scrubbedPayments = 0;
  let deletedSessions = 0;

  try {
    await client.query('BEGIN');

    if (reservationIds.length) {
      const r = await client.query(
        `UPDATE reservations
         SET id_photo_urls = '{}'::text[],
             transfer_proof_path = NULL,
             transfer_proof_name = NULL
         WHERE id = ANY($1::int[])`,
        [reservationIds]
      );
      scrubbedReservations = r.rowCount || 0;
    }

    if (reservationIds.length || bookingIds.length) {
      const p = await client.query(
        `UPDATE payments
         SET document_path = NULL
         WHERE document_path IS NOT NULL
           AND (
             reservation_id = ANY($1::int[])
             OR (booking_id IS NOT NULL AND booking_id = ANY($2::uuid[]))
           )`,
        [reservationIds, bookingIds.length ? bookingIds : []]
      );
      scrubbedPayments = p.rowCount || 0;
    }

    if (bookingIds.length) {
      const b = await client.query(
        `UPDATE bookings SET id_photo_urls = '{}'::text[] WHERE id = ANY($1::uuid[])`,
        [bookingIds]
      );
      scrubbedBookings = b.rowCount || 0;

      const s = await client.query(
        `DELETE FROM card_checkout_sessions WHERE booking_id = ANY($1::uuid[])`,
        [bookingIds]
      );
      deletedSessions += s.rowCount || 0;
    }

    if (staleSessions.length) {
      const staleIds = staleSessions.map((s) => s.id);
      const s2 = await client.query(
        `DELETE FROM card_checkout_sessions WHERE id = ANY($1::uuid[])`,
        [staleIds]
      );
      deletedSessions += s2.rowCount || 0;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  let deletedTelemetry = 0;
  try {
    const telemetry = await query(
      `WITH gone_errors AS (
         DELETE FROM site_guest_errors WHERE created_at < now() - interval '90 days' RETURNING 1
       ),
       gone_events AS (
         DELETE FROM site_guest_events WHERE created_at < now() - interval '90 days' RETURNING 1
       )
       SELECT
         (SELECT COUNT(*) FROM gone_errors)::int +
         (SELECT COUNT(*) FROM gone_events)::int AS deleted`
    );
    deletedTelemetry = Number(telemetry.rows[0]?.deleted || 0);
  } catch (err) {
    if (!/site_guest_/.test(String(err.message || ''))) throw err;
  }

  const summary = {
    dryRun: false,
    days,
    scrubbedReservations,
    scrubbedBookings,
    scrubbedPayments,
    deletedSessions,
    deletedTelemetry,
    media: mediaResult,
    protectedUnitUrls: protectedUrls.size,
  };

  if (
    scrubbedReservations ||
    scrubbedBookings ||
    deletedSessions ||
    mediaResult.destroyed
  ) {
    console.log('[data-retention]', JSON.stringify(summary));
  }

  return summary;
}

function startDataRetentionJob() {
  if (!isEnabled()) {
    console.log('[data-retention] disabled (DATA_RETENTION_ENABLED)');
    return null;
  }

  const interval = Number(process.env.DATA_RETENTION_INTERVAL_MS || 24 * 60 * 60 * 1000);
  const bootDelay = Number(process.env.DATA_RETENTION_BOOT_DELAY_MS || 60_000);

  const run = async () => {
    try {
      await runDataRetentionCleanup();
    } catch (err) {
      console.error('[data-retention]', err.message);
    }
  };

  const bootTimer = setTimeout(run, bootDelay);
  if (bootTimer.unref) bootTimer.unref();

  const timer = setInterval(run, interval);
  if (timer.unref) timer.unref();

  console.log(
    `[data-retention] media scrub scheduled every ${interval}ms (days=${retentionDays()}, dryRun=${isDryRun()})`
  );
  return timer;
}

module.exports = {
  startDataRetentionJob,
  runDataRetentionCleanup,
  retentionDays,
};
