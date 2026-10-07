const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseIcalEvents, isReservationEvent, airbnbDetails } = require('./otaIcalReservations');

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
  it('imports Airbnb "Reserved" stays but not host blocks', () => {
    const [stay, block] = parseIcalEvents(AIRBNB_ICS);
    assert.equal(isReservationEvent('airbnb', stay), true);
    assert.equal(isReservationEvent('airbnb', block), false);
  });

  it('treats Booking.com closed events as reservations', () => {
    const [ev] = parseIcalEvents(BOOKING_ICS);
    assert.equal(isReservationEvent('booking', ev), true);
    assert.equal(isReservationEvent('other', ev), false);
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
