const OTA_PLATFORMS = ['airbnb', 'booking', 'travigo', 'other'];

const OTA_PLATFORM_LABELS = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
  travigo: 'Travigo / Trivago',
  other: 'Other',
};

function normalizeOtaPlatform(value) {
  const p = String(value || '')
    .trim()
    .toLowerCase();
  return OTA_PLATFORMS.includes(p) ? p : null;
}

function detectPlatformFromUrl(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('airbnb')) return 'airbnb';
  if (u.includes('booking.com')) return 'booking';
  if (u.includes('travago') || u.includes('trivago')) return 'travigo';
  return 'other';
}

function icalSourceForPlatform(platform) {
  const p = normalizeOtaPlatform(platform) || 'other';
  return `ical:${p}`;
}

function isIcalOccupancySource(source) {
  return source === 'ical' || String(source || '').startsWith('ical:');
}

function calendarExportUrl(slug) {
  const base = String(process.env.FRONTEND_URL || 'https://cairohomes.com').replace(/\/$/, '');
  return `${base}/api/calendar/${slug}.ics`;
}

function assertValidIcalUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Enter a valid calendar URL (https://…)');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Calendar URL must use https://');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error('Calendar URL host is not allowed');
  }
  // Block private / link-local / metadata IP literals
  if (
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|100\.64\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host) ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('[')
  ) {
    throw new Error('Calendar URL must not target a private network');
  }
  return raw;
}

module.exports = {
  OTA_PLATFORMS,
  OTA_PLATFORM_LABELS,
  normalizeOtaPlatform,
  detectPlatformFromUrl,
  icalSourceForPlatform,
  isIcalOccupancySource,
  calendarExportUrl,
  assertValidIcalUrl,
};
