const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  GUEST_AVAILABILITY_MONTHS,
  REQUIRED_OCCUPANCY_TABLES,
  isIcalOccupancySource,
  occupancySql,
  mergeOccupancyByDate,
  applyCheckoutTurnover,
  occupancyDates,
  guestDatesMustIncludeSchedule,
} = require('./calendarOccupancy');

describe('calendar occupancy (Schedule ↔ guest)', () => {
  it('keeps iCal cache + reservations + bookings + explicit blocks in one query', () => {
    const sql = occupancySql({ wpScoped: true });
    for (const table of REQUIRED_OCCUPANCY_TABLES) {
      assert.match(sql, new RegExp(table));
    }
    assert.doesNotMatch(sql, /listing_ical/);
    assert.match(sql, /unit_ical_blocks/);
    assert.match(sql, /unit_ota_feeds/);
    assert.match(sql, /ical:/);
  });

  it('never drops Schedule/owner holds on a checkout day', () => {
    for (const source of ['manual', 'owner', 'csv_import', 'ch_availability_xlsx']) {
      const byDate = new Map([['2026-09-10', source]]);
      applyCheckoutTurnover(byDate, ['2026-09-10']);
      assert.equal(byDate.get('2026-09-10'), source, source);
    }
  });

  it('opens checkout morning when only unpriced or iCal leftover covers that day', () => {
    for (const source of ['unpriced', 'ical', 'ical:airbnb', 'ical:booking']) {
      const byDate = new Map([['2026-09-10', source]]);
      applyCheckoutTurnover(byDate, ['2026-09-10']);
      assert.equal(byDate.has('2026-09-10'), false, source);
    }
  });

  it('treats per-platform OTA sources as explicit holds', () => {
    assert.equal(isIcalOccupancySource('ical:airbnb'), true);
    assert.equal(isIcalOccupancySource('ical'), true);
    assert.equal(isIcalOccupancySource('manual'), false);
  });

  it('keeps a checkout day closed when the next stay occupies that night', () => {
    const byDate = new Map([['2026-09-10', 'reservation']]);
    applyCheckoutTurnover(byDate, ['2026-09-10']);
    assert.equal(byDate.get('2026-09-10'), 'reservation');
  });

  it('does not treat unpriced as a reason to drop an explicit hold', () => {
    const byDate = mergeOccupancyByDate(
      [
        { date: '2026-09-01', source: 'manual' },
        { date: '2026-09-02', source: 'ical:airbnb' },
      ],
      '2026-09-01',
      '2026-09-30'
    );
    byDate.set('2026-09-03', 'unpriced');
    applyCheckoutTurnover(byDate, ['2026-09-01', '2026-09-02']);
    assert.deepEqual(occupancyDates(byDate), ['2026-09-01', '2026-09-03']);
  });

  it('requires guest blocked dates (minus unpriced) to include every Schedule night', () => {
    const scheduleDates = ['2026-09-01', '2026-09-02', '2026-09-03'];
    const guest = [
      { date: '2026-09-01', source: 'manual' },
      { date: '2026-09-02', source: 'ical:airbnb' },
      { date: '2026-09-03', source: 'reservation' },
      { date: '2026-09-04', source: 'unpriced' },
    ];
    assert.deepEqual(guestDatesMustIncludeSchedule(scheduleDates, guest), []);
  });

  it('fails if a Schedule block is missing from the guest calendar', () => {
    const missing = guestDatesMustIncludeSchedule(
      ['2026-09-01', '2026-09-08'],
      [{ date: '2026-09-01', source: 'manual' }]
    );
    assert.deepEqual(missing, ['2026-09-08']);
  });

  it('keeps guest availability horizon aligned with the listing client', () => {
    const clientSrc = fs.readFileSync(
      path.join(__dirname, '../../../Client/src/constants/availability.js'),
      'utf8'
    );
    assert.equal(GUEST_AVAILABILITY_MONTHS, 12);
    assert.match(clientSrc, /GUEST_AVAILABILITY_MONTHS\s*=\s*12/);
  });

  it('wires Schedule and guest availability through the shared helper', () => {
    const pricing = fs.readFileSync(path.join(__dirname, '../services/pricing.js'), 'utf8');
    const units = fs.readFileSync(path.join(__dirname, '../routes/units.js'), 'utf8');
    const scheduleRoute = fs.readFileSync(path.join(__dirname, '../routes/pms/compat.js'), 'utf8');
    assert.match(pricing, /fetchCalendarOccupancyRows/);
    assert.match(units, /getBlockedDates/);
    assert.match(scheduleRoute, /fetchCalendarOccupancyRows/);
    const calendarRoute = scheduleRoute.slice(
      scheduleRoute.indexOf("router.get('/calendar-blocks'"),
      scheduleRoute.indexOf("router.put('/blocked-dates")
    );
    assert.doesNotMatch(calendarRoute, /FROM unit_blocked_dates/);
  });
});
