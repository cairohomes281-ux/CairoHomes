const { listProviders, getProvider, providerKeyForIcalPlatform, labelForProviderKey } = require('./registry');
const {
  listConnections,
  runChannelSync,
  syncIcalFeed,
  syncAllIcal,
  upsertApiConnection,
  updateApiConnection,
  upsertUnitMapping,
  updateIcalFeedMapping,
  listSyncLogs,
} = require('./syncEngine');
const { CAPABILITIES, ICAL_CAPABILITIES, FULL_API_CAPABILITIES } = require('./capabilities');
const {
  listThreads,
  getThread,
  replyToThread,
  unreadCount,
  ingestProviderMessages,
} = require('./messaging');
const { channelRevenueSummary } = require('./channelRevenue');

module.exports = {
  CAPABILITIES,
  ICAL_CAPABILITIES,
  FULL_API_CAPABILITIES,
  listProviders,
  getProvider,
  providerKeyForIcalPlatform,
  labelForProviderKey,
  listConnections,
  runChannelSync,
  syncIcalFeed,
  syncAllIcal,
  upsertApiConnection,
  updateApiConnection,
  upsertUnitMapping,
  updateIcalFeedMapping,
  listSyncLogs,
  listThreads,
  getThread,
  replyToThread,
  unreadCount,
  ingestProviderMessages,
  channelRevenueSummary,
};
