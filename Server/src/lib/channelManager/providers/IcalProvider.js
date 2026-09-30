const { BaseChannelProvider } = require('../BaseChannelProvider');
const { ICAL_CAPABILITIES } = require('../capabilities');
const { refreshIcalBlocks, refreshFeedBlocks, getEnabledOtaFeeds } = require('../../../services/ical');
const { GUEST_AVAILABILITY_MONTHS } = require('../../calendarOccupancy');
const { query } = require('../../../config/db');

function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

class IcalChannelProvider extends BaseChannelProvider {
  constructor() {
    super({
      key: 'ical',
      label: 'iCal calendar sync',
      connectionType: 'ical',
      capabilities: ICAL_CAPABILITIES,
      configured: true,
    });
  }

  async authenticate(connection) {
    if (!connection?.ical_url) {
      throw new Error('iCal connection requires an https calendar URL');
    }
    return { ok: true };
  }

  /**
   * Pull busy nights from the remote calendar into unit_ical_blocks.
   * Rates, full reservation payloads, and cancellations are not available over iCal.
   */
  async pullAvailability(connection, { monthsAhead = GUEST_AVAILABILITY_MONTHS } = {}) {
    const today = new Date();
    const from = localIso(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
    const to = localIso(
      new Date(today.getFullYear(), today.getMonth() + monthsAhead, today.getDate())
    );

    if (connection?.feed_id || connection?.id) {
      const feedId = connection.feed_id || connection.id;
      const { rows } = await query(
        `SELECT f.*, u.slug AS unit_slug, u.title AS unit_title
         FROM unit_ota_feeds f
         JOIN units u ON u.id = f.unit_id
         WHERE f.id = $1`,
        [feedId]
      );
      const feed = rows[0];
      if (!feed) throw new Error('iCal feed not found');
      if (!feed.enabled) {
        return { skipped: true, reason: 'disabled', datesWritten: 0, from, to };
      }
      const datesWritten = await refreshFeedBlocks(feed, { from, to });
      return { datesWritten, from, to, feed_id: feed.id, unit_id: feed.unit_id };
    }

    const result = await refreshIcalBlocks({
      monthsAhead,
      unitId: connection?.unit_id || null,
    });
    return result;
  }

  /** Export is served by /api/calendar/:slug.ics — push is "publish our calendar URL". */
  async pushAvailability(connection) {
    return {
      mode: 'export_url',
      message:
        'iCal cannot push inventory via API. Share the Cairo Homes export calendar URL with the channel.',
      export_hint: connection?.unit_slug
        ? `/api/calendar/${connection.unit_slug}.ics`
        : null,
    };
  }

  async listFeeds({ unitId = null } = {}) {
    return getEnabledOtaFeeds({ unitId });
  }
}

module.exports = { IcalChannelProvider };
