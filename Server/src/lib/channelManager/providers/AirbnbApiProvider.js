const { BaseChannelProvider } = require('../BaseChannelProvider');
const { FULL_API_CAPABILITIES } = require('../capabilities');
const { otaFetch, connectionConfigured } = require('../otaHttp');
const { buildAvailabilityPayload, buildRatesPayload, loadMappings } = require('../inventoryPush');
const {
  upsertChannelReservation,
  cancelChannelReservation,
} = require('../reservationImport');

function bookingSource() {
  return 'Airbnb';
}

class AirbnbApiProvider extends BaseChannelProvider {
  constructor() {
    super({
      key: 'airbnb_api',
      label: 'Airbnb (API)',
      connectionType: 'api',
      capabilities: FULL_API_CAPABILITIES,
      configured: true,
    });
  }

  describe() {
    return { ...super.describe(), configured: true };
  }

  async authenticate(connection) {
    if (!connectionConfigured(connection)) {
      throw new Error(
        'Airbnb API credentials incomplete. Set base_url and api_key (or client_id/client_secret) on the connection.'
      );
    }
    const path = connection.credentials?.auth_path || '/v2/health';
    try {
      await otaFetch(connection, path);
    } catch (err) {
      if (err.status && err.status !== 404) throw err;
    }
    return { ok: true };
  }

  async pushAvailability(connection) {
    await this.authenticate(connection);
    const payload = await buildAvailabilityPayload(connection);
    const path = connection.credentials?.availability_path || '/v2/calendar_operations';
    const result = await otaFetch(connection, path, { method: 'POST', body: payload });
    return { pushed_rooms: payload.rooms.length, from: payload.from, to: payload.to, result };
  }

  async pullAvailability(connection) {
    await this.authenticate(connection);
    const path = connection.credentials?.availability_pull_path || '/v2/calendars';
    return otaFetch(connection, path);
  }

  async pushRates(connection) {
    await this.authenticate(connection);
    const payload = await buildRatesPayload(connection);
    const path = connection.credentials?.rates_path || '/v2/pricing';
    const result = await otaFetch(connection, path, { method: 'POST', body: payload });
    return { pushed_rooms: payload.rooms.length, from: payload.from, to: payload.to, result };
  }

  async pullRates(connection) {
    await this.authenticate(connection);
    const path = connection.credentials?.rates_pull_path || '/v2/pricing';
    return otaFetch(connection, path);
  }

  async pullReservations(connection) {
    await this.authenticate(connection);
    const path = connection.credentials?.reservations_path || '/v2/reservations';
    const data = await otaFetch(connection, path);
    const list = Array.isArray(data?.reservations)
      ? data.reservations
      : Array.isArray(data)
        ? data
        : [];
    const mappings = await loadMappings(connection.id);
    const byExternal = new Map(mappings.map((m) => [String(m.external_listing_id), m]));
    const imported = [];
    for (const item of list) {
      const listingId = String(item.listing_id || item.external_listing_id || item.hosting_id || '');
      const map = byExternal.get(listingId);
      if (!map) continue;
      const externalId = String(item.confirmation_code || item.id || item.reservation_id || '');
      if (!externalId) continue;
      const status = String(item.status || '').toLowerCase();
      if (status.includes('cancel')) {
        await cancelChannelReservation(connection.id, externalId);
        imported.push({ external_id: externalId, action: 'cancelled' });
        continue;
      }
      const result = await upsertChannelReservation({
        connectionId: connection.id,
        bookingSource: bookingSource(),
        externalReservationId: externalId,
        unitId: map.unit_id,
        guestName: item.guest_name || item.guest?.full_name || 'Airbnb Guest',
        guestPhone: item.guest_phone || item.guest?.phone || null,
        guestEmail: item.guest_email || item.guest?.email || null,
        checkIn: String(item.start_date || item.check_in || item.checkin).slice(0, 10),
        checkOut: String(item.end_date || item.check_out || item.checkout).slice(0, 10),
        totalAmount: Number(item.expected_payout_amount || item.total_paid_amount || item.total || 0),
        channelCommissionAmount:
          item.host_fee != null
            ? Number(item.host_fee)
            : item.commission_amount != null
              ? Number(item.commission_amount)
              : null,
        channelCommissionPct: item.commission_pct != null ? Number(item.commission_pct) : null,
        status: 'confirmed',
        notes: item.notes || `Airbnb ${externalId}`,
        adults: Number(item.adults || item.guest_details?.number_of_adults) || 1,
        children: Number(item.children || item.guest_details?.number_of_children) || 0,
      });
      imported.push({ external_id: externalId, ...result });
    }
    return { fetched: list.length, imported: imported.length, results: imported };
  }

  async pullCancellations(connection) {
    return this.pullReservations(connection);
  }

  async pullModifications(connection) {
    return this.pullReservations(connection);
  }

  async pullMessages(connection) {
    await this.authenticate(connection);
    const path = connection.credentials?.messages_path || '/v2/threads';
    return otaFetch(connection, path);
  }

  async sendMessage(connection, { externalThreadId, body } = {}) {
    await this.authenticate(connection);
    const path =
      connection.credentials?.messages_send_path || `/v2/threads/${externalThreadId}/messages`;
    return otaFetch(connection, path, { method: 'POST', body: { message: body } });
  }
}

module.exports = { AirbnbApiProvider };
