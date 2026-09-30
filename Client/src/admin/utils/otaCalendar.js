const OTA_PLATFORM_LABELS = {
  airbnb: 'Airbnb',
  booking: 'Booking.com',
};

const OTA_LOOK = {
  airbnb: {
    badge: 'AB',
    label: 'Airbnb · outside booking',
    hatch: 'repeating-linear-gradient(135deg, #FF5A5F 0 3px, #fff5f5 3px 7px)',
    badgeClass: 'bg-[#FF5A5F] text-white shadow-sm',
    ringClass: 'ring-1 ring-inset ring-[#FF5A5F]',
    cellBg: 'bg-[#fff1f2]',
  },
  booking: {
    badge: 'BK',
    label: 'Booking.com · outside booking',
    hatch: 'repeating-linear-gradient(135deg, #003580 0 3px, #eef3fb 3px 7px)',
    badgeClass: 'bg-[#003580] text-white shadow-sm',
    ringClass: 'ring-1 ring-inset ring-[#003580]',
    cellBg: 'bg-[#e8eef8]',
  },
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
  if (platform === 'airbnb' || platform === 'booking') return OTA_LOOK[platform];
  return null;
}

export function otaBlockLabel(source) {
  return otaBlockLook(source)?.label || null;
}

export function otaBlockBadge(source) {
  return otaBlockLook(source)?.badge || null;
}
