/** Canonical booking / channel sources for reservations reporting. */
const BOOKING_SOURCES = [
  'Website',
  'Outside Channel',
  'Manual',
  'Broker',
  'Campaign',
  'Facebook Post',
];

const CHANNEL_REPORT_BUCKETS = ['Outside Channel', 'Website', 'Manual'];

function isOutsideChannelSource(value) {
  const lower = String(value || '').trim().toLowerCase();
  return (
    lower === 'outside channel' ||
    lower === 'airbnb' ||
    lower === 'booking' ||
    lower === 'booking.com' ||
    lower === 'bookingcom'
  );
}

function normalizeBookingSource(value, { hasBookingId = false } = {}) {
  const raw = String(value || '').trim();
  if (hasBookingId) return 'Website';
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'website' || lower === 'web') return 'Website';
  if (isOutsideChannelSource(raw)) return 'Outside Channel';
  if (lower === 'manual') return 'Manual';
  if (lower === 'broker') return 'Broker';
  if (lower === 'campaign') return 'Campaign';
  if (lower === 'facebook' || lower === 'facebook post') return 'Facebook Post';
  // Preserve unknown custom tags but title-case lightly
  return raw;
}

function isAirbnbBookingSource(value, opts) {
  return normalizeBookingSource(value, opts) === 'Airbnb';
}

function channelReportBucket(bookingSource, { hasBookingId = false } = {}) {
  const src = normalizeBookingSource(bookingSource, { hasBookingId });
  if (!src) return 'Manual';
  if (src === 'Outside Channel') return 'Outside Channel';
  if (src === 'Website') return 'Website';
  return 'Manual';
}

function providerKeyForSource(source) {
  return channelReportBucket(source) === 'Outside Channel' ? 'airbnb_api' : null;
}

module.exports = {
  BOOKING_SOURCES,
  CHANNEL_REPORT_BUCKETS,
  normalizeBookingSource,
  isOutsideChannelSource,
  isAirbnbBookingSource,
  channelReportBucket,
  providerKeyForSource,
};
