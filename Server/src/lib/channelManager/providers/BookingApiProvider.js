const { BaseChannelProvider } = require('../BaseChannelProvider');
const { FULL_API_CAPABILITIES } = require('../capabilities');
const { otaFetch, connectionConfigured } = require('../otaHttp');
const { buildAvailabilityPayload, buildRatesPayload, loadMappings } = require('../inventoryPush');
const {
  upsertChannelReservation,
  cancelChannelReservation,
} = require('../reservationImport');

function bookingSource() {
  return 'Booking.com';
}

class BookingApiProvider extends BaseChannelProvider {
  constructor() {
    super({
      key: 'booking_api',
      label: 'Booking.com (API)',
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
        'Booking.com API credentials incomplete. Set base_url and api_key (or client_id/client_secret) on the connection.'
      );
    }
    const hotelId = connection.credentials?.hotel_id;
    const path = connection.credentials?.auth_path || '/v1/health';
    try {
      await otaFetch(connection, path, {
        query: hotelId ? { hotel_id: hotelId } : undefined,
      });
    } catch (err) {
      // Some gateways have no health route — credentials presence is enough to attempt sync.
      if (err.status && err.status !== 404) throw err;
    }
    return { ok: true };
  }

  async pushAvailability(connection) {
    await this.authenticate(connection);
    const payload = await buildAvailabilityPayload(connection);
    const path = connection.credentials?.availability_path || '/v1/availability';
    const result = await otaFetch(connection, path, { method: 'PUT', body: payload });
    return { pushed_rooms: payload.rooms.length, from: payload.from, to: payload.to, result };
  }

  async pullAvailability(connection) {
    await this.authenticate(connection);
    const path = connection.credentials?.availability_pull_path || '/v1/availability';
    const data = await otaFetch(connection, path, {
      query: { hotel_id: connection.credentials?.hotel_id },
    });
    return { raw: data, note: 'Availability deltas applied via reservation/block sync when provided' };
  }

  async pushRates(connection) {
    await this.authenticate(connection);
    const payload = await buildRatesPayload(connection);
    const path = connection.credentials?.rates_path || '/v1/rates';
    const result = await otaFetch(connection, path, { method: 'PUT', body: payload });
    return { pushed_rooms: payload.rooms.length, from: payload.from, to: payload.to, result };
  }

  async pullRates(connection) {
    await this.authenticate(connection);
    const path = connection.credentials?.rates_pull_path || '/v1/rates';
    return otaFetch(connection, path, { query: { hotel_id: connection.credentials?.hotel_id } });
  }

  async pullReservations(connection) {
    await this.authenticate(connection);
    const path = connection.credentials?.reservations_path || '/v1/reservations';
    const data = await otaFetch(connection, path, {
      query: { hotel_id: connection.credentials?.hotel_id },
    });
    const list = Array.isArray(data?.reservations)
      ? data.reservations
      : Array.isArray(data)
        ? data
        : [];
    const mappings = await loadMappings(connection.id);
    const byExternal = new Map(mappings.map((m) => [String(m.external_listing_id), m]));
    const imported = [];
    for (const item of list) {
      const listingId = String(
        item.room_id || item.listing_id || item.external_listing_id || item.room_type_id || ''
      );
      const map = byExternal.get(listingId);
      if (!map) continue;
      const externalId = String(item.id || item.reservation_id || item.confirmation_number || '');
      if (!externalId) continue;
      const status = String(item.status || '').toLowerCase();
      if (status === 'cancelled' || status === 'canceled') {
        await cancelChannelReservation(connection.id, externalId);
        imported.push({ external_id: externalId, action: 'cancelled' });
        continue;
      }
      const result = await upsertChannelReservation({
        connectionId: connection.id,
        bookingSource: bookingSource(),
        externalReservationId: externalId,
        unitId: map.unit_id,
        guestName: item.guest_name || item.guest?.name || 'Booking.com Guest',
        guestPhone: item.guest_phone || item.guest?.phone || null,
        guestEmail: item.guest_email || item.guest?.email || null,
        checkIn: String(item.check_in || item.arrival || item.checkin).slice(0, 10),
        checkOut: String(item.check_out || item.departure || item.checkout).slice(0, 10),
        totalAmount: Number(item.total_amount || item.total || item.price || 0),
        channelCommissionAmount:
          item.commission_amount != null ? Number(item.commission_amount) : null,
        channelCommissionPct: item.commission_pct != null ? Number(item.commission_pct) : null,
        status: 'confirmed',
        notes: item.notes || `Booking.com ${externalId}`,
        adults: Number(item.adults) || 1,
        children: Number(item.children) || 0,
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
    const path = connection.credentials?.messages_path || '/v1/messages';
    return otaFetch(connection, path, { query: { hotel_id: connection.credentials?.hotel_id } });
  }

  async sendMessage(connection, { externalThreadId, body } = {}) {
    await this.authenticate(connection);
    const path = connection.credentials?.messages_send_path || '/v1/messages';
    return otaFetch(connection, path, {
      method: 'POST',
      body: { thread_id: externalThreadId, body },
    });
  }
}

module.exports = { BookingApiProvider };
