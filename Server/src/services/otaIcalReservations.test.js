const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseIcalEvents,
  isReservationEvent,
  airbnbDetails,
  stayToCancel,
  confirmStayDates,
  splitParentUid,
  matchImportedStay,
} = require('./otaIcalReservations');

const AIRBNB_ICS = `BEGIN:VCALENDAR
PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN
BEGIN:VEVENT
DTEND;VALUE=DATE:20261015
DTSTART;VALUE=DATE:20261012
UID:1418fb94e984-0a7f6b5c3a0d1c11b1f7b1b2c1d1e1f1@airbnb.com
DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de
 tails/HMABC12345\\nPhone Number (Last 4 Digits): 4821
SUMMARY:Reserved
END:VEVENT
BEGIN:VEVENT
DTEND;VALUE=DATE:20261101
DTSTART;VALUE=DATE:20261028
UID:7f3a2b1c-blocked@airbnb.com
SUMMARY:Airbnb (Not available)
END:VEVENT
END:VCALENDAR`;

const BOOKING_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:a1b2c3d4@booking.com
DTSTART;VALUE=DATE:20261120
DTEND;VALUE=DATE:20261123
SUMMARY:CLOSED - Not available
END:VEVENT
END:VCALENDAR`;

describe('parseIcalEvents', () => {
  it('reads uid, dates, summary and unfolded description', () => {
    const [stay, block] = parseIcalEvents(AIRBNB_ICS);
    assert.equal(stay.uid, '1418fb94e984-0a7f6b5c3a0d1c11b1f7b1b2c1d1e1f1@airbnb.com');
    assert.equal(stay.start, '2026-10-12');
    assert.equal(stay.end, '2026-10-15');
    assert.equal(stay.summary, 'Reserved');
    assert.match(stay.description, /details\/HMABC12345\nPhone Number/);
    assert.equal(block.summary, 'Airbnb (Not available)');
  });
});

describe('isReservationEvent', () => {
  it('imports Airbnb reserved stays only — host Not available stays as calendar blocks', () => {
    const [stay, block] = parseIcalEvents(AIRBNB_ICS);
    assert.equal(isReservationEvent('airbnb', stay), true);
    assert.equal(isReservationEvent('airbnb', block), false);
  });

  it('does not import Booking.com events, because that calendar already follows Airbnb', () => {
    const [ev] = parseIcalEvents(BOOKING_ICS);
    assert.equal(isReservationEvent('booking', ev), false);
    assert.equal(isReservationEvent('other', ev), false);
  });
});

describe('stayToCancel', () => {
  const airbnb = {
    id: 1,
    booking_source: 'Airbnb',
    ota_event_uid: 'a',
    status: 'confirmed',
    guest_name: 'Airbnb guest',
    guest_phone: '',
    total_amount: 0,
    check_in: '2026-10-14',
    check_out: '2026-10-18',
  };
  const booking = {
    ...airbnb,
    id: 2,
    booking_source: 'Booking.com',
    ota_event_uid: 'b',
    guest_name: 'Booking.com guest',
    check_in: '2026-10-16',
    check_out: '2026-10-20',
  };

  it('drops the Booking.com echo when both stays still need details', () => {
    assert.equal(stayToCancel(airbnb, booking)?.id, 2);
  });

  it('keeps a stay that already has guest details', () => {
    const filled = { ...booking, guest_name: 'Sara Ali', guest_phone: '0100', total_amount: 3000 };
    assert.equal(stayToCancel(airbnb, filled)?.id, 1);
  });

  it('leaves two stays that do not share a night', () => {
    assert.equal(stayToCancel(airbnb, { ...booking, check_in: '2026-10-18', check_out: '2026-10-21' }), null);
  });
});

describe('confirmStayDates', () => {
  it('splits a blocked span into the stay the staff confirms and the nights left over', () => {
    const confirmed = confirmStayDates('2026-10-21', '2026-10-25', '2026-10-21', '2026-10-23');
    assert.equal(confirmed.error, undefined);
    assert.deepEqual(confirmed.leftovers, [['2026-10-23', '2026-10-25']]);
  });

  it('keeps a night before the confirmed stay as its own reservation', () => {
    const confirmed = confirmStayDates('2026-10-21', '2026-10-25', '2026-10-23', '2026-10-25');
    assert.deepEqual(confirmed.leftovers, [['2026-10-21', '2026-10-23']]);
  });

  it('refuses dates outside the blocked nights', () => {
    const confirmed = confirmStayDates('2026-10-21', '2026-10-25', '2026-10-20', '2026-10-23');
    assert.match(confirmed.error, /inside the blocked nights/);
  });

  it('reads the parent id from a split stay', () => {
    const uid = 'split:abc%40airbnb.com:2026-10-23:2026-10-25';
    assert.equal(splitParentUid(uid), 'abc@airbnb.com');
    assert.equal(splitParentUid('real-event@airbnb.com'), null);
  });
});

describe('airbnbDetails', () => {
  it('extracts the reservation code and phone last 4 digits', () => {
    const [stay] = parseIcalEvents(AIRBNB_ICS);
    assert.deepEqual(airbnbDetails(stay.description), { code: 'HMABC12345', last4: '4821' });
  });

  it('returns nulls when the description is missing', () => {
    assert.deepEqual(airbnbDetails(''), { code: null, last4: null });
  });
});

describe('matchImportedStay', () => {
  const reserved = {
    id: 1,
    ota_event_uid: 'reserved@airbnb.com',
    check_in: '2026-10-21',
    check_out: '2026-10-24',
  };
  const orphan = {
    id: 2,
    ota_event_uid: null,
    check_in: '2026-11-01',
    check_out: '2026-11-03',
  };

  it('matches by event UID', () => {
    const hit = matchImportedStay([reserved, orphan], {
      uid: 'reserved@airbnb.com',
      start: '2026-10-21',
      end: '2026-10-24',
    }, new Set());
    assert.equal(hit?.id, 1);
  });

  it('does not reuse a cancelled booking UID for a new Not available block on the same nights', () => {
    const hit = matchImportedStay([reserved], {
      uid: 'blocked-after-cancel@airbnb.com',
      start: '2026-10-21',
      end: '2026-10-24',
    }, new Set());
    assert.equal(hit, null);
  });

  it('still matches a stay that never got a UID when the dates line up', () => {
    const hit = matchImportedStay([orphan], {
      uid: 'new@airbnb.com',
      start: '2026-11-01',
      end: '2026-11-03',
    }, new Set());
    assert.equal(hit?.id, 2);
  });
});
