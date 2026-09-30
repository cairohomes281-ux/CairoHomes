const crypto = require('crypto');
const { query } = require('../config/db');
const {
  attachFacilities,
  projectFacilitiesMap,
  loadTodayPriceMap,
} = require('../routes/units');

const DELIVER_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;

function webhookConfigured() {
  const url = String(process.env.PARTNER_WEBHOOK_URL || '').trim();
  const secret = String(process.env.PARTNER_WEBHOOK_SECRET || '').trim();
  return Boolean(url && secret);
}

/** Same eligibility as GET /api/partners/v1/inventory */
function isPartnerFeedUnit(row) {
  if (!row) return false;
  if (String(row.status || '') !== 'published') return false;
  return String(row.listing_type || 'rent').toLowerCase() === 'rent';
}

function signBody(rawBody, secret) {
  const hex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${hex}`;
}

function verifySignature(rawBody, signatureHeader, secret) {
  const expected = signBody(rawBody, secret);
  const got = String(signatureHeader || '').trim();
  if (!got || expected.length !== got.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
  } catch {
    return false;
  }
}

async function loadPublicPartnerUnit(unitId) {
  const { rows } = await query(`SELECT * FROM units WHERE id = $1`, [unitId]);
  const row = rows[0];
  if (!row || !isPartnerFeedUnit(row)) return { row: row || null, unit: null };

  const facilitiesByProject = await projectFacilitiesMap([row.compound || row.project]);
  const { today, map: todayPriceByWp } = await loadTodayPriceMap([row.wp_post_id]);
  return {
    row,
    unit: attachFacilities(row, facilitiesByProject, todayPriceByWp, today),
  };
}

async function logDelivery({
  id,
  event,
  unitId = null,
  status,
  httpStatus = null,
  error = null,
  payload = null,
}) {
  try {
    await query(
      `INSERT INTO partner_webhook_deliveries
         (id, event, unit_id, status, http_status, error, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        id,
        event,
        unitId,
        status,
        httpStatus,
        error,
        payload != null ? JSON.stringify(payload) : null,
      ]
    );
  } catch (err) {
    console.warn('[partner-webhook] log skipped:', err.message);
  }
}

async function postOnce(url, rawBody, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DELIVER_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: rawBody,
      signal: ctrl.signal,
      redirect: 'error',
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Deliver a signed webhook to the partner. Never throws to callers.
 * Payload intentionally matches the public inventory shape only.
 */
async function deliverPartnerWebhook({ event, data, unitId = null }) {
  if (!webhookConfigured()) return { skipped: true, reason: 'not_configured' };

  const url = String(process.env.PARTNER_WEBHOOK_URL).trim();
  const secret = String(process.env.PARTNER_WEBHOOK_SECRET).trim();
  const id = crypto.randomUUID();
  const envelope = {
    id,
    event,
    created_at: new Date().toISOString(),
    data,
  };
  const rawBody = JSON.stringify(envelope);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'CairoHomes-PartnerWebhook/1.0',
    'X-CairoHomes-Event': event,
    'X-CairoHomes-Delivery-Id': id,
    'X-CairoHomes-Signature': signBody(rawBody, secret),
  };

  let lastError = null;
  let lastStatus = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await postOnce(url, rawBody, headers);
      lastStatus = result.status;
      if (result.ok) {
        await logDelivery({
          id,
          event,
          unitId,
          status: 'success',
          httpStatus: result.status,
          payload: envelope,
        });
        return { ok: true, id, status: result.status };
      }
      lastError = `HTTP ${result.status}${result.body ? `: ${result.body}` : ''}`;
    } catch (err) {
      lastError = err.name === 'AbortError' ? 'timeout' : err.message;
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 250 * attempt));
    }
  }

  await logDelivery({
    id,
    event,
    unitId,
    status: 'error',
    httpStatus: lastStatus,
    error: lastError,
    payload: envelope,
  });
  console.warn('[partner-webhook] delivery failed', event, unitId, lastError);
  return { ok: false, id, error: lastError };
}

/**
 * Decide upserted vs removed and notify the partner.
 * @param {{ unitId: string, previousEligible?: boolean|null, forceRemoved?: boolean, removedSlug?: string|null }} opts
 */
async function notifyPartnerInventoryChange({
  unitId,
  previousEligible = null,
  forceRemoved = false,
  removedSlug = null,
} = {}) {
  try {
    if (!webhookConfigured() || !unitId) return { skipped: true };

    if (forceRemoved) {
      return deliverPartnerWebhook({
        event: 'inventory.unit.removed',
        unitId,
        data: {
          unit_id: unitId,
          slug: removedSlug || null,
          unit: null,
        },
      });
    }

    const { row, unit } = await loadPublicPartnerUnit(unitId);
    const eligible = Boolean(unit);

    if (eligible) {
      return deliverPartnerWebhook({
        event: 'inventory.unit.upserted',
        unitId,
        data: {
          unit_id: unitId,
          slug: unit.slug || row?.slug || null,
          unit,
        },
      });
    }

    // Only notify removal when we know it was previously on the partner feed.
    if (previousEligible === true) {
      return deliverPartnerWebhook({
        event: 'inventory.unit.removed',
        unitId,
        data: {
          unit_id: unitId,
          slug: row?.slug || removedSlug || null,
          unit: null,
        },
      });
    }

    return { skipped: true, reason: 'not_on_feed' };
  } catch (err) {
    console.warn('[partner-webhook] notify failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/** Fire-and-forget wrapper for route handlers. */
function queuePartnerInventoryNotify(opts) {
  setImmediate(() => {
    notifyPartnerInventoryChange(opts).catch((err) => {
      console.warn('[partner-webhook] queue error:', err.message);
    });
  });
}

module.exports = {
  webhookConfigured,
  isPartnerFeedUnit,
  signBody,
  verifySignature,
  loadPublicPartnerUnit,
  deliverPartnerWebhook,
  notifyPartnerInventoryChange,
  queuePartnerInventoryNotify,
};
