const SESSION_KEY = 'ch_guest_session';
const ENDPOINT = '/api/site-telemetry';

const queue = { errors: [], events: [] };
let flushTimer = null;
let installed = false;

function isStaffSurface() {
  if (typeof window === 'undefined') return true;
  const path = window.location.pathname || '';
  return path.startsWith('/admin') || path.startsWith('/sales');
}

export function guestSessionId() {
  if (typeof window === 'undefined') return '';
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

export function eventFromPath(pathname, search = '') {
  const path = String(pathname || '/');
  if (path === '/' || path === '/home') return { event: 'view_home' };
  if (path === '/search' || path === '/long-term') return { event: 'view_search' };
  const listing = path.match(/^\/listings\/([^/]+)/);
  if (listing) return { event: 'view_listing', unit_slug: listing[1] };
  if (path === '/checkout/payment/callback') return { event: 'view_payment_callback' };
  if (path === '/checkout/payment') return { event: 'view_payment' };
  if (path === '/checkout') return { event: 'view_checkout' };
  if (path === '/booking-success') return { event: 'booking_submitted' };
  if (path === '/sign-in') {
    return String(search).includes('staff=1') ? null : { event: 'view_signin' };
  }
  if (path === '/sign-up') return { event: 'view_signup' };
  if (path === '/contact') return { event: 'view_contact' };
  return { event: 'view_page' };
}

function classifyApiError(url, status) {
  const path = String(url || '');
  if (path.includes('/staff/')) return null;
  if (path.includes('/site-telemetry')) return null;
  if (path.includes('/auth/me')) return null;
  if (status === 404 && /\/units\//i.test(path)) return 'not_found';
  if (/\/bookings\/checkout/i.test(path)) return 'checkout';
  if (/\/payments\//i.test(path)) return 'payment';
  if (/\/auth\//i.test(path)) return 'auth';
  return 'api';
}

function enqueue(kind, item) {
  if (!item || isStaffSurface()) return;
  queue[kind].push({ ...item, session_id: guestSessionId() });
  if (queue.errors.length + queue.events.length >= 8) {
    flushTelemetry();
    return;
  }
  if (!flushTimer) flushTimer = setTimeout(flushTelemetry, 2500);
}

export function reportError(payload) {
  if (!payload?.message) return;
  enqueue('errors', {
    error_type: payload.type || payload.error_type || 'js',
    message: String(payload.message).slice(0, 400),
    path: payload.path || (typeof window !== 'undefined' ? window.location.pathname : '/'),
    status_code: payload.status || payload.status_code || null,
  });
}

export function reportEvent(payload) {
  if (!payload?.event) return;
  enqueue('events', {
    event: payload.event,
    path: payload.path || (typeof window !== 'undefined' ? window.location.pathname : '/'),
    duration_ms: payload.duration_ms,
    unit_slug: payload.unit_slug || null,
  });
}

export function reportApiError(error) {
  const url = error?.config?.url || '';
  const status = error?.response?.status;
  const type = classifyApiError(url, status);
  if (!type) return;
  const message =
    error?.response?.data?.error || error?.message || `Request failed${status ? ` (${status})` : ''}`;
  reportError({ type, message, path: typeof window !== 'undefined' ? window.location.pathname : url, status });
}

export function flushTelemetry() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const errors = queue.errors.splice(0, 25);
  const events = queue.events.splice(0, 25);
  if (!errors.length && !events.length) return;
  const body = JSON.stringify({ errors, events });
  if (typeof fetch === 'function') {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

export function installSiteTelemetry() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (event) => {
    if (isStaffSurface()) return;
    const message = event?.message || event?.error?.message;
    if (!message) return;
    reportError({ type: 'js', message });
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (isStaffSurface()) return;
    const reason = event?.reason;
    const message = reason?.message || (typeof reason === 'string' ? reason : '');
    if (!message) return;
    reportError({ type: 'js', message });
  });
  window.addEventListener('pagehide', flushTelemetry);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushTelemetry();
  });
}
