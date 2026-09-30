const { query } = require('../../config/db');
const { CAPABILITIES } = require('./capabilities');
const { getProvider, providerKeyForIcalPlatform, listProviders } = require('./registry');
const { writeSyncLog, listSyncLogs } = require('./syncLogs');
const { GUEST_AVAILABILITY_MONTHS } = require('../calendarOccupancy');
const { calendarExportUrl, OTA_PLATFORM_LABELS, normalizeOtaPlatform } = require('../otaPlatforms');

function deriveFeedStatus(feed) {
  if (!feed?.enabled) return 'disconnected';
  if (feed.sync_status === 'syncing') return 'syncing';
  if (feed.last_sync_error) return 'failed';
  if (feed.last_sync_at) return 'connected';
  return feed.sync_status || 'disconnected';
}

async function setFeedSyncStatus(feedId, status, { error = null, touchSuccess = false } = {}) {
  await query(
    `UPDATE unit_ota_feeds
     SET sync_status = $2,
         last_sync_error = CASE WHEN $3::boolean THEN NULL ELSE COALESCE($4, last_sync_error) END,
         last_sync_at = CASE WHEN $5::boolean THEN now() ELSE last_sync_at END,
         updated_at = now()
     WHERE id = $1`,
    [feedId, status, touchSuccess, error, touchSuccess]
  );
}

async function listIcalConnections() {
  const { rows } = await query(
    `SELECT f.id, f.unit_id, f.wp_post_id, f.platform, f.label, f.ical_url, f.enabled,
            f.external_listing_id, f.sync_status, f.last_sync_at, f.last_sync_error, f.updated_at,
            u.slug AS unit_slug, u.title AS unit_title, u.unit_number
     FROM unit_ota_feeds f
     JOIN units u ON u.id = f.unit_id
     ORDER BY u.title NULLS LAST, f.platform`
  );
  return rows.map((feed) => ({
    id: feed.id,
    kind: 'ical_feed',
    connection_type: 'ical',
    provider_key: providerKeyForIcalPlatform(feed.platform),
    provider_label: `${OTA_PLATFORM_LABELS[feed.platform] || feed.platform} (iCal)`,
    display_name: feed.label || OTA_PLATFORM_LABELS[feed.platform] || feed.platform,
    enabled: feed.enabled,
    sync_enabled: feed.enabled,
    status: deriveFeedStatus(feed),
    last_sync_at: feed.last_sync_at,
    last_sync_error: feed.last_sync_error,
    unit_id: feed.unit_id,
    unit_slug: feed.unit_slug,
    unit_title: feed.unit_title,
    unit_number: feed.unit_number,
    external_listing_id: feed.external_listing_id || null,
    ical_url: feed.ical_url,
    export_url: feed.unit_slug ? calendarExportUrl(feed.unit_slug) : null,
    capabilities: getProvider('ical')?.capabilities || [],
  }));
}

async function listApiConnections() {
  try {
    const { rows } = await query(
      `SELECT c.*,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'id', m.id,
                   'unit_id', m.unit_id,
                   'external_listing_id', m.external_listing_id,
                   'external_room_type_id', m.external_room_type_id,
                   'external_rate_plan_id', m.external_rate_plan_id
                 ) ORDER BY m.updated_at DESC)
                 FROM channel_unit_mappings m WHERE m.connection_id = c.id),
                '[]'::json
              ) AS mappings
       FROM channel_connections c
       ORDER BY c.updated_at DESC`
    );
    return rows.map((c) => {
      const provider = getProvider(c.provider_key);
      const creds = c.credentials && typeof c.credentials === 'object' ? c.credentials : {};
      const hasCredentials = Boolean(
        creds.api_key ||
          creds.access_token ||
          creds.client_id ||
          creds.client_secret ||
          (creds.base_url && Object.keys(creds).length > 1)
      );
      return {
        id: c.id,
        kind: 'api_connection',
        connection_type: c.connection_type,
        provider_key: c.provider_key,
        provider_label: provider?.label || c.provider_key,
        display_name: c.display_name || provider?.label || c.provider_key,
        enabled: c.enabled,
        sync_enabled: c.sync_enabled,
        status: c.sync_status,
        last_sync_at: c.last_sync_at,
        last_sync_error: c.last_sync_error,
        mappings: c.mappings || [],
        capabilities: provider?.capabilities || [],
        config: c.config || {},
        credential_keys: Object.keys(creds),
        configured: hasCredentials,
        has_credentials: hasCredentials,
      };
    });
  } catch (err) {
    if (/channel_connections/i.test(err.message)) return [];
    throw err;
  }
}

async function listConnections() {
  const [ical, api] = await Promise.all([listIcalConnections(), listApiConnections()]);
  return { ical, api, providers: listProviders() };
}

async function syncIcalFeed(feedId) {
  const provider = getProvider('ical');
  const { rows } = await query(
    `SELECT f.*, u.slug AS unit_slug FROM unit_ota_feeds f
     JOIN units u ON u.id = f.unit_id WHERE f.id = $1`,
    [feedId]
  );
  const feed = rows[0];
  if (!feed) throw new Error('Feed not found');

  const providerKey = providerKeyForIcalPlatform(feed.platform);
  await setFeedSyncStatus(feed.id, 'syncing');
  await writeSyncLog({
    feedId: feed.id,
    unitId: feed.unit_id,
    providerKey,
    direction: 'inbound',
    operation: 'availability_pull',
    status: 'partial',
    message: 'Sync started',
  });

  try {
    await provider.authenticate({ ical_url: feed.ical_url });
    const result = await provider.pullAvailability({
      id: feed.id,
      feed_id: feed.id,
      unit_id: feed.unit_id,
      unit_slug: feed.unit_slug,
      ical_url: feed.ical_url,
    });
    await setFeedSyncStatus(feed.id, 'connected', { touchSuccess: true });
    await writeSyncLog({
      feedId: feed.id,
      unitId: feed.unit_id,
      providerKey,
      direction: 'inbound',
      operation: 'availability_pull',
      status: 'success',
      message: `Imported ${result.datesWritten || 0} busy night(s)`,
      details: result,
    });
    return { ok: true, result, status: 'connected' };
  } catch (err) {
    await setFeedSyncStatus(feed.id, 'failed', { error: err.message });
    await writeSyncLog({
      feedId: feed.id,
      unitId: feed.unit_id,
      providerKey,
      direction: 'inbound',
      operation: 'availability_pull',
      status: 'error',
      message: err.message,
    });
    return { ok: false, error: err.message, status: 'failed' };
  }
}

async function syncAllIcal({ unitId = null } = {}) {
  const params = [];
  let filter = '';
  if (unitId) {
    params.push(unitId);
    filter = `AND unit_id = $1`;
  }
  const { rows: feeds } = await query(
    `SELECT id FROM unit_ota_feeds WHERE enabled = true ${filter}`,
    params
  );
  const results = [];
  for (const feed of feeds) {
    results.push({ feed_id: feed.id, ...(await syncIcalFeed(feed.id)) });
  }
  return {
    feeds: feeds.length,
    errors: results.filter((r) => !r.ok).length,
    results,
    monthsAhead: GUEST_AVAILABILITY_MONTHS,
  };
}

async function syncApiConnection(connectionId) {
  const { rows } = await query(`SELECT * FROM channel_connections WHERE id = $1`, [connectionId]);
  const connection = rows[0];
  if (!connection) throw new Error('Connection not found');
  if (!connection.enabled || !connection.sync_enabled) {
    return { ok: false, error: 'Connection sync is disabled', status: 'disconnected' };
  }

  const provider = getProvider(connection.provider_key);
  if (!provider) throw new Error(`Unknown provider: ${connection.provider_key}`);

  await query(
    `UPDATE channel_connections SET sync_status = 'syncing', updated_at = now() WHERE id = $1`,
    [connectionId]
  );

  try {
    const outcomes = {};
    await provider.authenticate(connection);

    if (provider.supports(CAPABILITIES.AVAILABILITY_PUSH)) {
      try {
        outcomes.availability_push = await provider.pushAvailability(connection);
      } catch (err) {
        outcomes.availability_push = { error: err.message };
      }
    }
    if (provider.supports(CAPABILITIES.RATES_PUSH)) {
      try {
        outcomes.rates_push = await provider.pushRates(connection);
      } catch (err) {
        outcomes.rates_push = { error: err.message };
      }
    }
    if (provider.supports(CAPABILITIES.AVAILABILITY_PULL)) {
      try {
        outcomes.availability_pull = await provider.pullAvailability(connection);
      } catch (err) {
        outcomes.availability_pull = { error: err.message };
      }
    }
    if (provider.supports(CAPABILITIES.RESERVATIONS_PULL)) {
      outcomes.reservations = await provider.pullReservations(connection);
    }
    if (provider.supports(CAPABILITIES.CANCELLATIONS_PULL)) {
      try {
        outcomes.cancellations = await provider.pullCancellations(connection);
      } catch (err) {
        outcomes.cancellations = { error: err.message };
      }
    }
    if (provider.supports(CAPABILITIES.MODIFICATIONS_PULL)) {
      try {
        outcomes.modifications = await provider.pullModifications(connection);
      } catch (err) {
        outcomes.modifications = { error: err.message };
      }
    }
    if (provider.supports(CAPABILITIES.MESSAGES_PULL)) {
      try {
        const { ingestProviderMessages } = require('./messaging');
        const raw = await provider.pullMessages(connection);
        outcomes.messages = await ingestProviderMessages(connection, raw);
      } catch (err) {
        outcomes.messages = { error: err.message };
      }
    }

    const hardFail =
      outcomes.reservations?.error ||
      (outcomes.availability_push?.error && outcomes.rates_push?.error);

    await query(
      `UPDATE channel_connections
       SET sync_status = $2, last_sync_at = now(),
           last_sync_error = $3, updated_at = now()
       WHERE id = $1`,
      [
        connectionId,
        hardFail ? 'failed' : 'connected',
        hardFail ? String(hardFail) : null,
      ]
    );
    await writeSyncLog({
      connectionId,
      providerKey: connection.provider_key,
      direction: 'inbound',
      operation: 'full_sync',
      status: hardFail ? 'error' : 'success',
      message: hardFail ? String(hardFail) : 'API sync completed',
      details: outcomes,
    });
    return { ok: !hardFail, result: outcomes, status: hardFail ? 'failed' : 'connected' };
  } catch (err) {
    await query(
      `UPDATE channel_connections
       SET sync_status = 'failed', last_sync_error = $2, updated_at = now()
       WHERE id = $1`,
      [connectionId, err.message]
    );
    await writeSyncLog({
      connectionId,
      providerKey: connection.provider_key,
      direction: 'inbound',
      operation: 'full_sync',
      status: 'error',
      message: err.message,
    });
    return { ok: false, error: err.message, status: 'failed' };
  }
}

/**
 * Central Channel Manager sync entrypoint.
 * Prefer this over calling refreshIcalBlocks directly from routes/cron.
 */
async function runChannelSync({ unitId = null, feedId = null, connectionId = null } = {}) {
  if (feedId) return syncIcalFeed(feedId);
  if (connectionId) return syncApiConnection(connectionId);
  const ical = await syncAllIcal({ unitId });
  const { rows: apiRows } = await query(
    `SELECT id FROM channel_connections WHERE enabled = true AND sync_enabled = true AND connection_type = 'api'`
  );
  const apiResults = [];
  for (const row of apiRows) {
    apiResults.push({ connection_id: row.id, ...(await syncApiConnection(row.id)) });
  }
  return {
    ...ical,
    api_connections: apiRows.length,
    api_errors: apiResults.filter((r) => !r.ok).length,
    api_results: apiResults,
  };
}

async function upsertApiConnection({
  providerKey,
  displayName = null,
  credentials = {},
  config = {},
  enabled = true,
  syncEnabled = true,
} = {}) {
  const provider = getProvider(providerKey);
  if (!provider || provider.connectionType !== 'api') {
    throw new Error('Invalid API provider');
  }
  const { rows } = await query(
    `INSERT INTO channel_connections
       (provider_key, connection_type, display_name, credentials, config, enabled, sync_enabled, sync_status)
     VALUES ($1,'api',$2,$3::jsonb,$4::jsonb,$5,$6,'disconnected')
     RETURNING *`,
    [
      provider.key,
      displayName || provider.label,
      JSON.stringify(credentials || {}),
      JSON.stringify(config || {}),
      enabled !== false,
      syncEnabled !== false,
    ]
  );
  return rows[0];
}

async function updateApiConnection(
  connectionId,
  {
    displayName = undefined,
    credentials = undefined,
    config = undefined,
    enabled = undefined,
    syncEnabled = undefined,
  } = {}
) {
  const { rows: existing } = await query(`SELECT * FROM channel_connections WHERE id = $1`, [
    connectionId,
  ]);
  const row = existing[0];
  if (!row) throw new Error('Connection not found');

  const nextCreds =
    credentials && typeof credentials === 'object'
      ? { ...(row.credentials || {}), ...credentials }
      : row.credentials;
  const nextConfig =
    config && typeof config === 'object' ? { ...(row.config || {}), ...config } : row.config;

  const { rows } = await query(
    `UPDATE channel_connections SET
       display_name = COALESCE($2, display_name),
       credentials = $3::jsonb,
       config = $4::jsonb,
       enabled = COALESCE($5, enabled),
       sync_enabled = COALESCE($6, sync_enabled),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      connectionId,
      displayName ?? null,
      JSON.stringify(nextCreds || {}),
      JSON.stringify(nextConfig || {}),
      enabled === undefined ? null : Boolean(enabled),
      syncEnabled === undefined ? null : Boolean(syncEnabled),
    ]
  );
  return rows[0];
}

async function upsertUnitMapping({
  connectionId,
  unitId,
  externalListingId,
  externalRoomTypeId = null,
  externalRatePlanId = null,
} = {}) {
  if (!connectionId || !unitId || !externalListingId) {
    throw new Error('connectionId, unitId, and externalListingId are required');
  }
  const { rows } = await query(
    `INSERT INTO channel_unit_mappings
       (connection_id, unit_id, external_listing_id, external_room_type_id, external_rate_plan_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (connection_id, unit_id) DO UPDATE SET
       external_listing_id = EXCLUDED.external_listing_id,
       external_room_type_id = EXCLUDED.external_room_type_id,
       external_rate_plan_id = EXCLUDED.external_rate_plan_id,
       updated_at = now()
     RETURNING *`,
    [connectionId, unitId, String(externalListingId).trim(), externalRoomTypeId, externalRatePlanId]
  );
  return rows[0];
}

async function updateIcalFeedMapping(feedId, { externalListingId = null, label = null } = {}) {
  const { rows } = await query(
    `UPDATE unit_ota_feeds
     SET external_listing_id = COALESCE($2, external_listing_id),
         label = COALESCE($3, label),
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [feedId, externalListingId, label]
  );
  return rows[0] || null;
}

module.exports = {
  listConnections,
  listIcalConnections,
  listApiConnections,
  runChannelSync,
  syncIcalFeed,
  syncAllIcal,
  syncApiConnection,
  upsertApiConnection,
  updateApiConnection,
  upsertUnitMapping,
  updateIcalFeedMapping,
  listSyncLogs,
  deriveFeedStatus,
  normalizeOtaPlatform,
};
