const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseIcalBusyDates, looksLikeIcal } = require('../services/ical');

describe('parseIcalBusyDates', () => {
  it('parses VALUE=DATE events with exclusive DTEND', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260310
DTEND;VALUE=DATE:20260312
SUMMARY:Booked
END:VEVENT
END:VCALENDAR`;
    assert.deepEqual(parseIcalBusyDates(ics, '2026-03-01', '2026-04-01'), [
      '2026-03-10',
      '2026-03-11',
    ]);
  });

  it('parses DATE-TIME values using the calendar day', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20260315T150000Z
DTEND:20260317T110000Z
SUMMARY:Stay
END:VEVENT
END:VCALENDAR`;
    assert.deepEqual(parseIcalBusyDates(ics, '2026-03-01', '2026-04-01'), [
      '2026-03-15',
      '2026-03-16',
    ]);
  });

  it('handles folded lines', () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260401
DTEND;VALUE=DATE:
 20260403
END:VEVENT
END:VCALENDAR`;
    assert.deepEqual(parseIcalBusyDates(ics, '2026-04-01', '2026-05-01'), [
      '2026-04-01',
      '2026-04-02',
    ]);
  });

  it('detects ical payloads', () => {
    assert.equal(looksLikeIcal('BEGIN:VCALENDAR\nEND:VCALENDAR'), true);
    assert.equal(looksLikeIcal('<html>login</html>'), false);
  });
});
