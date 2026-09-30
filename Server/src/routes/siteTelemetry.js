const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../config/db');
const { sanitizeError, sanitizeEvent } = require('../lib/siteTelemetry');

const router = express.Router();
const MAX_ITEMS = 25;

const ingestLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many telemetry reports' },
});

function asList(value) {
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS);
  if (value && typeof value === 'object') return [value];
  return [];
}

async function ingest(req, res, next) {
  try {
    const errors = asList(req.body?.errors)
      .map((row) =>
        sanitizeError({
          ...row,
          user_agent: row.user_agent || req.get('user-agent'),
        })
      )
      .filter(Boolean);
    const events = asList(req.body?.events).map(sanitizeEvent).filter(Boolean);

    if (req.body?.error_type || req.body?.type || req.body?.message) {
      const one = sanitizeError({
        ...req.body,
        user_agent: req.body.user_agent || req.get('user-agent'),
      });
      if (one) errors.push(one);
    }
    if (req.body?.event) {
      const one = sanitizeEvent(req.body);
      if (one) events.push(one);
    }

    if (errors.length) {
      const values = [];
      const params = [];
      errors.slice(0, MAX_ITEMS).forEach((row, i) => {
        const n = i * 8;
        values.push(
          `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},$${n + 7},$${n + 8})`
        );
        params.push(
          row.fingerprint,
          row.error_type,
          row.message,
          row.path,
          row.status_code,
          row.session_id,
          row.user_agent,
          JSON.stringify(row.meta)
        );
      });
      await query(
        `INSERT INTO site_guest_errors
          (fingerprint, error_type, message, path, status_code, session_id, user_agent, meta)
         VALUES ${values.join(',')}`,
        params
      );
    }

    if (events.length) {
      const values = [];
      const params = [];
      events.slice(0, MAX_ITEMS).forEach((row, i) => {
        const n = i * 6;
        values.push(`($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6})`);
        params.push(
          row.event,
          row.path,
          row.duration_ms,
          row.session_id,
          row.unit_slug,
          JSON.stringify(row.meta)
        );
      });
      await query(
        `INSERT INTO site_guest_events
          (event, path, duration_ms, session_id, unit_slug, meta)
         VALUES ${values.join(',')}`,
        params
      );
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

router.post('/', ingestLimit, ingest);
router.post('/batch', ingestLimit, ingest);

module.exports = router;
