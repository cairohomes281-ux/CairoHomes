/** Canonical booking / channel sources for reservations reporting. */
const BOOKING_SOURCES = [
  'Website',
  'Airbnb',
  'Booking.com',
  'Outside Channel',
  'Manual',
  'Broker',
  'Campaign',
];

/** Channels staff must pick when filling an imported Outside Channel stay. */
const OUTSIDE_CHANNEL_FLAGS = ['Airbnb', 'Booking.com'];

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

/** Airbnb / Booking.com stay flagged, still counted as Outside Channel in reports. */
function normalizeOutsideChannelFlag(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (lower === 'airbnb') return 'Airbnb';
  if (lower === 'booking' || lower === 'booking.com' || lower === 'bookingcom') return 'Booking.com';
  if (lower === 'outside channel') return 'Outside Channel';
  return null;
}

function normalizeBookingSource(value, { hasBookingId = false } = {}) {
  const raw = String(value || '').trim();
  if (hasBookingId) return 'Website';
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'website' || lower === 'web') return 'Website';
  const outside = normalizeOutsideChannelFlag(raw);
  if (outside) return outside;
  if (lower === 'manual') return 'Manual';
  if (lower === 'broker') return 'Broker';
  if (lower === 'campaign') return 'Campaign';
  if (lower === 'facebook' || lower === 'facebook post') return 'Facebook Post';
  // Preserve unknown custom tags but title-case lightly
  return raw;
}

/** Legacy helper. Airbnb/Booking stays are Outside Channel and are not auto-paid. */
function isAirbnbBookingSource() {
  return false;
}

function channelReportBucket(bookingSource, { hasBookingId = false } = {}) {
  if (hasBookingId) return 'Website';
  if (isOutsideChannelSource(bookingSource)) return 'Outside Channel';
  const src = normalizeBookingSource(bookingSource, { hasBookingId });
  if (!src) return 'Manual';
  if (src === 'Website') return 'Website';
  return 'Manual';
}

function providerKeyForSource(source) {
  return channelReportBucket(source) === 'Outside Channel' ? 'airbnb_api' : null;
}

module.exports = {
  BOOKING_SOURCES,
  OUTSIDE_CHANNEL_FLAGS,
  CHANNEL_REPORT_BUCKETS,
  normalizeBookingSource,
  normalizeOutsideChannelFlag,
  isOutsideChannelSource,
  isAirbnbBookingSource,
  channelReportBucket,
  providerKeyForSource,
};
