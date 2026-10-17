const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildExportEvents, renderExportIcs } = require('./calendarExport');

describe('calendarExport (PMS → Airbnb)', () => {
  const unit = { id: 'unit-1', slug: 'demo-home' };
  const now = new Date('2026-10-17T12:00:00Z');

  it('exports active PMS reservations and website bookings', () => {
    const events = buildExportEvents({
      unit,
      now,
      bookings: [{ id: 'b1', checkin: '2026-11-01', checkout: '2026-11-04' }],
      reservations: [
        { id: 10, check_in: '2026-11-10', check_out: '2026-11-12', status: 'confirmed' },
      ],
      blockedDates: ['2026-12-01', '2026-12-02'],
    });
    assert.equal(events.some((e) => e.uid.startsWith('book-b1')), true);
    assert.equal(events.some((e) => e.uid === 'res-10@cairohomes.com' && e.status === 'CONFIRMED'), true);
    assert.equal(events.some((e) => e.summary === 'Blocked'), true);
  });

  it('does not echo Airbnb-imported stays back to Airbnb', () => {
    const events = buildExportEvents({
      unit,
      now,
      reservations: [
        {
          id: 11,
          check_in: '2026-11-10',
          check_out: '2026-11-12',
          status: 'confirmed',
          ota_event_uid: 'abc@airbnb.com',
        },
      ],
    });
    assert.equal(events.length, 0);
  });

  it('keeps cancelled PMS stays as past CANCELLED tombstones with the same UID', () => {
    const events = buildExportEvents({
      unit,
      now,
      reservations: [
        {
          id: 12,
          check_in: '2026-11-10',
          check_out: '2026-11-15',
          status: 'cancelled',
          updated_at: '2026-10-16T09:00:00Z',
        },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].uid, 'res-12@cairohomes.com');
    assert.equal(events[0].status, 'CANCELLED');
    assert.equal(events[0].start, '1970-01-01');
    assert.equal(events[0].end, '1970-01-02');
    assert.ok(events[0].sequence >= 1);
  });

  it('renders a valid ICS with DTSTAMP and REFRESH-INTERVAL', () => {
    const events = buildExportEvents({
      unit,
      now,
      reservations: [
        { id: 1, check_in: '2026-11-01', check_out: '2026-11-03', status: 'confirmed' },
      ],
    });
    const ics = renderExportIcs(events, { calendarName: 'Demo' });
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /REFRESH-INTERVAL/);
    assert.match(ics, /DTSTAMP:/);
    assert.match(ics, /UID:res-1@cairohomes\.com/);
    assert.match(ics, /STATUS:CONFIRMED/);
  });
});
