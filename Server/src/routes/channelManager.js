const express = require('express');
const { query } = require('../config/db');
const { authStaff, requireRoles, requirePasswordChanged } = require('../middleware/auth');
const {
  listConnections,
  listProviders,
  runChannelSync,
  upsertApiConnection,
  updateApiConnection,
  upsertUnitMapping,
  updateIcalFeedMapping,
  listSyncLogs,
  listThreads,
  getThread,
  replyToThread,
  unreadCount,
  channelRevenueSummary,
} = require('../lib/channelManager');
const {
  normalizeOtaPlatform,
  assertValidIcalUrl,
  calendarExportUrl,
  OTA_PLATFORM_LABELS,
} = require('../lib/otaPlatforms');

const router = express.Router();
const ROLES = ['admin', 'reservations', 'reservations_web', 'reservations_manual', 'reservations_manager'];

router.use(authStaff, requirePasswordChanged, requireRoles(...ROLES));

router.get('/providers', (_req, res) => {
  res.json({ providers: listProviders() });
});

router.get('/connections', async (_req, res, next) => {
  try {
    const data = await listConnections();
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.get('/channel-stats', async (req, res, next) => {
  try {
    const from = req.query.from || null;
    const to = req.query.to || null;
    const summary = await channelRevenueSummary({ from, to });
    res.json(summary);
  } catch (e) {
    next(e);
  }
});

router.get('/overview', async (_req, res, next) => {
  try {
    const { calendarExportUrl: exportUrl } = require('../lib/otaPlatforms');
    const { rows: units } = await query(
      `SELECT id, wp_post_id, slug, title, unit_number, status
       FROM units
       WHERE status = 'published'
       ORDER BY title NULLS LAST, unit_number NULLS LAST`
    );
    const { rows: feeds } = await query(
      `SELECT id, unit_id, wp_post_id, platform, label, ical_url, enabled,
              external_listing_id, sync_status, last_sync_at, last_sync_error, updated_at
       FROM unit_ota_feeds
       ORDER BY platform`
    );
    const feedsByUnit = new Map();
    for (const feed of feeds) {
      if (!feedsByUnit.has(feed.unit_id)) feedsByUnit.set(feed.unit_id, []);
      const status =
        !feed.enabled
          ? 'disconnected'
          : feed.sync_status === 'syncing'
            ? 'syncing'
            : feed.last_sync_error
              ? 'failed'
              : feed.last_sync_at
                ? 'connected'
                : feed.sync_status || 'disconnected';
      feedsByUnit.get(feed.unit_id).push({
        ...feed,
        connection_type: 'ical',
        status,
        provider_label: `${OTA_PLATFORM_LABELS[feed.platform] || feed.platform} (iCal)`,
      });
    }
    const [connections, revenue] = await Promise.all([
      listConnections(),
      channelRevenueSummary({}).catch(() => ({ channels: [], totals: {} })),
    ]);
    res.json({
      units: units.map((unit) => ({
        ...unit,
        export_url: unit.slug ? exportUrl(unit.slug) : null,
        feeds: feedsByUnit.get(unit.id) || [],
      })),
      connections,
      providers: listProviders(),
      revenue,
    });
  } catch (e) {
    next(e);
  }
});

router.post('/sync', async (req, res, next) => {
  try {
    const { unit_id: unitId = null, feed_id: feedId = null, connection_id: connectionId = null } =
      req.body || {};
    const result = await runChannelSync({ unitId, feedId, connectionId });
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get('/sync-logs', async (req, res, next) => {
  try {
    const logs = await listSyncLogs({
      limit: req.query.limit,
      feedId: req.query.feed_id || null,
      connectionId: req.query.connection_id || null,
      unitId: req.query.unit_id || null,
    });
    res.json({ logs });
  } catch (e) {
    next(e);
  }
});

router.post('/connections/api', async (req, res, next) => {
  try {
    const {
      provider_key: providerKey,
      display_name: displayName,
      credentials = {},
      config = {},
      enabled = true,
      sync_enabled: syncEnabled = true,
    } = req.body || {};
    const row = await upsertApiConnection({
      providerKey,
      displayName,
      credentials,
      config,
      enabled,
      syncEnabled,
    });
    res.status(201).json({ connection: row });
  } catch (e) {
    if (/Invalid API provider|not configured/i.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

router.patch('/connections/api/:id', async (req, res, next) => {
  try {
    const {
      display_name: displayName,
      credentials,
      config,
      enabled,
      sync_enabled: syncEnabled,
    } = req.body || {};
    const row = await updateApiConnection(req.params.id, {
      displayName,
      credentials,
      config,
      enabled,
      syncEnabled,
    });
    res.json({ connection: row });
  } catch (e) {
    if (/Connection not found/i.test(e.message)) {
      return res.status(404).json({ error: e.message });
    }
    next(e);
  }
});

router.put('/connections/api/:id/mappings', async (req, res, next) => {
  try {
    const {
      unit_id: unitId,
      external_listing_id: externalListingId,
      external_room_type_id: externalRoomTypeId,
      external_rate_plan_id: externalRatePlanId,
    } = req.body || {};
    const mapping = await upsertUnitMapping({
      connectionId: req.params.id,
      unitId,
      externalListingId,
      externalRoomTypeId,
      externalRatePlanId,
    });
    res.json({ mapping });
  } catch (e) {
    if (/required/i.test(e.message)) return res.status(400).json({ error: e.message });
    next(e);
  }
});

router.delete('/connections/api/:id/mappings/:mappingId', async (req, res, next) => {
  try {
    await query(`DELETE FROM channel_unit_mappings WHERE id = $1 AND connection_id = $2`, [
      req.params.mappingId,
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get('/messages/unread-count', async (_req, res, next) => {
  try {
    const count = await unreadCount();
    res.json({ count });
  } catch (e) {
    next(e);
  }
});

router.get('/messages/threads', async (req, res, next) => {
  try {
    const threads = await listThreads({
      limit: req.query.limit,
      connectionId: req.query.connection_id || null,
    });
    res.json({ threads });
  } catch (e) {
    if (/channel_message_threads/i.test(e.message)) {
      return res.json({ threads: [] });
    }
    next(e);
  }
});

router.get('/messages/threads/:id', async (req, res, next) => {
  try {
    const thread = await getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    await query(
      `UPDATE channel_message_threads SET unread_count = 0, updated_at = now() WHERE id = $1`,
      [req.params.id]
    ).catch(() => {});
    res.json({ thread: { ...thread, unread_count: 0 } });
  } catch (e) {
    next(e);
  }
});

router.post('/messages/threads/:id/reply', async (req, res, next) => {
  try {
    const message = await replyToThread(req.params.id, req.body?.body, req.user);
    res.status(201).json({ message });
  } catch (e) {
    if (/required|not found|does not support/i.test(e.message)) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

router.patch('/feeds/:feedId', async (req, res, next) => {
  try {
    const {
      external_listing_id: externalListingId,
      label,
      enabled,
      ical_url: icalUrl,
    } = req.body || {};

    if (icalUrl !== undefined) {
      const platformRow = await query(`SELECT platform, unit_id FROM unit_ota_feeds WHERE id = $1`, [
        req.params.feedId,
      ]);
      if (!platformRow.rows[0]) return res.status(404).json({ error: 'Feed not found' });
      if (icalUrl === null || icalUrl === '') {
        await query(`DELETE FROM unit_ota_feeds WHERE id = $1`, [req.params.feedId]);
        return res.json({ ok: true, cleared: true });
      }
      const url = assertValidIcalUrl(icalUrl);
      const { rows } = await query(
        `UPDATE unit_ota_feeds
         SET ical_url = $2,
             enabled = COALESCE($3, enabled),
             label = COALESCE($4, label),
             external_listing_id = COALESCE($5, external_listing_id),
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [req.params.feedId, url, enabled, label ?? null, externalListingId ?? null]
      );
      return res.json({ feed: rows[0] });
    }

    if (enabled !== undefined) {
      const { rows } = await query(
        `UPDATE unit_ota_feeds
         SET enabled = $2,
             sync_status = CASE WHEN $2 THEN sync_status ELSE 'disconnected' END,
             label = COALESCE($3, label),
             external_listing_id = COALESCE($4, external_listing_id),
             updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [req.params.feedId, Boolean(enabled), label ?? null, externalListingId ?? null]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Feed not found' });
      return res.json({ feed: rows[0] });
    }

    const feed = await updateIcalFeedMapping(req.params.feedId, {
      externalListingId: externalListingId ?? null,
      label: label ?? null,
    });
    if (!feed) return res.status(404).json({ error: 'Feed not found' });
    res.json({ feed });
  } catch (e) {
    if (e.message?.includes('calendar URL') || e.message?.includes('https')) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

/** Convenience: create/update an iCal feed with explicit unit ↔ external listing mapping. */
router.put('/ical/:unitId/:platform', async (req, res, next) => {
  try {
    const platform = normalizeOtaPlatform(req.params.platform);
    if (!platform) return res.status(400).json({ error: 'Invalid platform' });

    const { rows: u } = await query(
      `SELECT id, wp_post_id, slug, title FROM units WHERE id = $1`,
      [req.params.unitId]
    );
    if (!u[0]?.wp_post_id) return res.status(404).json({ error: 'Unit not found' });

    const {
      ical_url: icalUrl,
      label,
      enabled,
      external_listing_id: externalListingId,
    } = req.body || {};

    if (icalUrl === null || icalUrl === '') {
      await query(`DELETE FROM unit_ota_feeds WHERE unit_id = $1 AND platform = $2`, [
        u[0].id,
        platform,
      ]);
      return res.json({ ok: true, cleared: true, platform });
    }

    const url = assertValidIcalUrl(icalUrl);
    const { rows } = await query(
      `INSERT INTO unit_ota_feeds
         (unit_id, wp_post_id, platform, label, ical_url, enabled, external_listing_id, sync_status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'disconnected',now())
       ON CONFLICT (unit_id, platform) DO UPDATE SET
         ical_url = EXCLUDED.ical_url,
         label = EXCLUDED.label,
         enabled = EXCLUDED.enabled,
         external_listing_id = EXCLUDED.external_listing_id,
         updated_at = now()
       RETURNING *`,
      [
        u[0].id,
        u[0].wp_post_id,
        platform,
        label || null,
        url,
        enabled !== false,
        externalListingId || null,
      ]
    );

    await query(
      `INSERT INTO listing_ical (wordpress_post_id, listing_slug, ical_url, notes, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (wordpress_post_id) DO UPDATE SET
         ical_url = EXCLUDED.ical_url,
         listing_slug = EXCLUDED.listing_slug,
         notes = EXCLUDED.notes,
         updated_at = now()`,
      [u[0].wp_post_id, u[0].slug, url, label || null]
    );
    await query(`UPDATE units SET ical_url = $1, updated_at = now() WHERE id = $2`, [url, u[0].id]);

    const sync = await runChannelSync({ feedId: rows[0].id });
    res.json({
      feed: rows[0],
      sync,
      export_url: u[0].slug ? calendarExportUrl(u[0].slug) : null,
      connection_type: 'ical',
      note: 'iCal syncs availability blocks only — not rates, restrictions, or full reservation payloads.',
    });
  } catch (e) {
    if (e.message?.includes('calendar URL') || e.message?.includes('https')) {
      return res.status(400).json({ error: e.message });
    }
    next(e);
  }
});

module.exports = router;
