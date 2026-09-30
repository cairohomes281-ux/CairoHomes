const crypto = require('crypto');

const ERROR_TYPES = new Set(['js', 'api', 'payment', 'checkout', 'auth', 'not_found']);

const EVENT_NAMES = new Set([
  'view_home',
  'view_search',
  'view_listing',
  'view_checkout',
  'view_payment',
  'view_payment_callback',
  'view_signin',
  'view_signup',
  'view_contact',
  'view_page',
  'page_timing',
  'checkout_submit',
  'booking_submitted',
  'payment_redirect',
  'payment_success',
  'payment_fail',
]);

const NOISE_ERROR = [
  /resizeobserver/i,
  /^script error\.?$/i,
  /chrome-extension:/i,
  /moz-extension:/i,
  /reading 'startTime'/i,
  /loading chunk/i,
  /failed to fetch dynamically imported module/i,
];

const STAFF_PATH = /^\/(admin|sales)(\/|$)/i;

function clampText(value, max = 400) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function redactPii(value) {
  return clampText(value, 500)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, '[phone]')
    .replace(/Bearer\s+\S+/gi, '[token]')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+/g, '[token]');
}

function normalizePath(value) {
  const raw = clampText(value, 180) || '/';
  const path = raw.split('?')[0].split('#')[0] || '/';
  return path
    .replace(/\/listings\/[^/]+/i, '/listings/:slug')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d{3,}\b/g, '/:id');
}

function isStaffPath(path) {
  return STAFF_PATH.test(String(path || ''));
}

function isNoisyError(message) {
  const text = String(message || '');
  return NOISE_ERROR.some((re) => re.test(text));
}

function fingerprint(type, message, path) {
  const key = `${type}|${clampText(message, 200).toLowerCase()}|${normalizePath(path)}`;
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function classifyApiError(url, status) {
  const path = String(url || '');
  if (status === 404 && /\/units\//i.test(path)) return 'not_found';
  if (/\/bookings\/checkout/i.test(path)) return 'checkout';
  if (/\/payments\//i.test(path)) return 'payment';
  if (/\/auth\//i.test(path) && !/\/staff\//i.test(path)) return 'auth';
  return 'api';
}

function sanitizeError(input = {}) {
  const message = redactPii(input.message || input.error || 'Unknown error');
  if (!message || isNoisyError(message)) return null;
  const path = normalizePath(input.path || '/');
  if (isStaffPath(path)) return null;
  const type = ERROR_TYPES.has(input.error_type || input.type)
    ? input.error_type || input.type
    : 'js';
  const status = Number(input.status_code || input.status);
  return {
    fingerprint: fingerprint(type, message, path),
    error_type: type,
    message,
    path,
    status_code: Number.isFinite(status) && status >= 100 && status <= 599 ? Math.round(status) : null,
    session_id: clampText(input.session_id, 64) || null,
    user_agent: clampText(input.user_agent, 180) || null,
    meta: {},
  };
}

function sanitizeEvent(input = {}) {
  const event = String(input.event || '').trim();
  if (!EVENT_NAMES.has(event)) return null;
  const path = normalizePath(input.path || '/');
  if (isStaffPath(path)) return null;
  const duration = Number(input.duration_ms);
  return {
    event,
    path,
    duration_ms:
      Number.isFinite(duration) && duration >= 0 && duration <= 600000 ? Math.round(duration) : null,
    session_id: clampText(input.session_id, 64) || null,
    unit_slug: clampText(input.unit_slug, 80) || null,
    meta: {},
  };
}

function parseRange(query = {}) {
  const to = String(query.to_date || '').slice(0, 10);
  const from = String(query.from_date || '').slice(0, 10);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const end = /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : today;
  const fallback = new Date(`${end}T12:00:00Z`);
  fallback.setUTCDate(fallback.getUTCDate() - 6);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : fallback.toISOString().slice(0, 10);
  if (start > end) return { from: end, to: start };
  return { from: start, to: end };
}

module.exports = {
  ERROR_TYPES,
  EVENT_NAMES,
  clampText,
  redactPii,
  normalizePath,
  isStaffPath,
  isNoisyError,
  fingerprint,
  classifyApiError,
  sanitizeError,
  sanitizeEvent,
  parseRange,
};
