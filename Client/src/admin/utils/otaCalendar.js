const OTA_PLATFORM_LABELS = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
};

const OUTSIDE_LOOK = {
  badge: 'OC',
  label: 'Outside Channel',
  hatch: 'repeating-linear-gradient(135deg, #b5725a 0 3px, #fdf6f2 3px 7px)',
  badgeClass: 'bg-[#b5725a] text-white shadow-sm',
  ringClass: 'ring-1 ring-inset ring-[#b5725a]',
  cellBg: 'bg-[#fdf6f2]',
};

const OTA_LOOK = {
  airbnb: OUTSIDE_LOOK,
  booking: OUTSIDE_LOOK,
};

export function isOtaBlockSource(source) {
  return source === 'ical' || String(source || '').startsWith('ical:');
}

export function otaBlockRank(source) {
  return isOtaBlockSource(source) ? 2 : 0;
}

export function otaPlatformFromSource(source) {
  if (!isOtaBlockSource(source)) return null;
  if (source === 'ical') return 'other';
  return source.split(':')[1] || 'other';
}

export function otaBlockLook(source) {
  if (!isOtaBlockSource(source)) return null;
  const platform = otaPlatformFromSource(source);
  return OTA_LOOK[platform] || OUTSIDE_LOOK;
}

export function otaBlockLabel(source) {
  return otaBlockLook(source)?.label || null;
}

export function otaBlockBadge(source) {
  return otaBlockLook(source)?.badge || null;
}
