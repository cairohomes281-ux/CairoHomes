/** Canonical booking / channel sources for reservations reporting. */
const BOOKING_SOURCES = [
  'Website',
  'Airbnb',
  'Booking.com',
  'Manual',
  'Private',
  'Broker',
  'Campaign',
  'Facebook Post',
];

const CHANNEL_REPORT_BUCKETS = ['Airbnb', 'Booking.com', 'Website', 'Manual'];

function normalizeBookingSource(value, { hasBookingId = false } = {}) {
  const raw = String(value || '').trim();
  if (hasBookingId) return 'Website';
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower === 'website' || lower === 'web') return 'Website';
  if (lower === 'airbnb') return 'Airbnb';
  if (lower === 'booking' || lower === 'booking.com' || lower === 'bookingcom') return 'Booking.com';
  if (lower === 'manual') return 'Manual';
  if (lower === 'private') return 'Private';
  if (lower === 'broker') return 'Broker';
  if (lower === 'campaign') return 'Campaign';
  if (lower === 'facebook' || lower === 'facebook post') return 'Facebook Post';
  // Preserve unknown custom tags but title-case lightly
  return raw;
}

function channelReportBucket(bookingSource, { hasBookingId = false } = {}) {
  const src = normalizeBookingSource(bookingSource, { hasBookingId });
  if (!src) return 'Manual';
  if (src === 'Airbnb') return 'Airbnb';
  if (src === 'Booking.com') return 'Booking.com';
  if (src === 'Website') return 'Website';
  return 'Manual';
}

function providerKeyForSource(source) {
  const bucket = channelReportBucket(source);
  if (bucket === 'Airbnb') return 'airbnb_api';
  if (bucket === 'Booking.com') return 'booking_api';
  return null;
}

module.exports = {
  BOOKING_SOURCES,
  CHANNEL_REPORT_BUCKETS,
  normalizeBookingSource,
  channelReportBucket,
  providerKeyForSource,
};
