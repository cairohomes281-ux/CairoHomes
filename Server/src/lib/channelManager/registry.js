const { IcalChannelProvider } = require('./providers/IcalProvider');
const { BookingApiProvider } = require('./providers/BookingApiProvider');
const { AirbnbApiProvider } = require('./providers/AirbnbApiProvider');
const { OTA_PLATFORM_LABELS } = require('../otaPlatforms');

const providers = new Map();

function registerDefaults() {
  const list = [new IcalChannelProvider(), new BookingApiProvider(), new AirbnbApiProvider()];
  for (const p of list) providers.set(p.key, p);
}

registerDefaults();

function getProvider(key) {
  const k = String(key || '').trim().toLowerCase();
  if (k.startsWith('ical')) return providers.get('ical');
  return providers.get(k) || null;
}

function listProviders() {
  return [...providers.values()].map((p) => p.describe());
}

function providerKeyForIcalPlatform(platform) {
  return `ical:${platform || 'other'}`;
}

function labelForProviderKey(key) {
  const k = String(key || '');
  if (k.startsWith('ical:')) {
    const platform = k.slice(5);
    return `${OTA_PLATFORM_LABELS[platform] || platform} (iCal)`;
  }
  const p = getProvider(k);
  return p?.label || k;
}

module.exports = {
  getProvider,
  listProviders,
  registerDefaults,
  providerKeyForIcalPlatform,
  labelForProviderKey,
};
