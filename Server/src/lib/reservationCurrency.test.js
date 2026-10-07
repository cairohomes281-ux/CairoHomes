const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReservationCurrency } = require('./reservationCurrency');

test('no currency in body leaves it unchanged', () => {
  assert.equal(parseReservationCurrency({}), null);
  assert.equal(parseReservationCurrency({ currency: '' }), null);
});

test('EGP always uses rate 1', () => {
  assert.deepEqual(parseReservationCurrency({ currency: 'egp', exchange_rate: '50' }), {
    currency: 'EGP',
    exchange_rate: 1,
  });
});

test('USD keeps the given rate', () => {
  assert.deepEqual(parseReservationCurrency({ currency: 'USD', exchange_rate: '52.43151' }), {
    currency: 'USD',
    exchange_rate: 52.4315,
  });
});

test('USD without a valid rate is rejected', () => {
  for (const exchange_rate of [undefined, '', '0', '-3', 'abc']) {
    assert.throws(() => parseReservationCurrency({ currency: 'USD', exchange_rate }), (err) => err.status === 400);
  }
});

test('unknown currency is rejected', () => {
  assert.throws(() => parseReservationCurrency({ currency: 'EUR' }), (err) => err.status === 400);
});
