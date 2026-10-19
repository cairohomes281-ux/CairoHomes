const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseReservationCurrency } = require('./reservationCurrency');

describe('parseReservationCurrency', () => {
  it('no currency in body leaves it unchanged', () => {
    assert.equal(parseReservationCurrency({}), null);
    assert.equal(parseReservationCurrency({ currency: '' }), null);
  });

  it('accepts EGP with rate 1', () => {
    assert.deepEqual(parseReservationCurrency({ currency: 'egp', exchange_rate: '50' }), {
      currency: 'EGP',
      exchange_rate: 1,
    });
  });

  it('accepts USD with a positive rate', () => {
    assert.deepEqual(parseReservationCurrency({ currency: 'USD', exchange_rate: '52.43151' }), {
      currency: 'USD',
      exchange_rate: 52.4315,
    });
  });

  it('accepts EUR and other guest currencies', () => {
    assert.deepEqual(parseReservationCurrency({ currency: 'EUR', exchange_rate: '56.2' }), {
      currency: 'EUR',
      exchange_rate: 56.2,
    });
  });

  it('rejects USD without a rate', () => {
    for (const exchange_rate of [undefined, null, '', 0, -1]) {
      assert.throws(
        () => parseReservationCurrency({ currency: 'USD', exchange_rate }),
        (err) => err.status === 400
      );
    }
  });

  it('rejects unknown currency', () => {
    assert.throws(() => parseReservationCurrency({ currency: 'XYZ' }), (err) => err.status === 400);
  });
});
