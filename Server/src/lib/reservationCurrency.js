/**
 * Reservation amounts are always stored in EGP. A reservation agreed in another
 * currency keeps `currency` + `exchange_rate` (EGP per 1 unit) for display.
 */
const {
  MONEY_CURRENCIES,
  DEFAULT_USD_EGP_RATE,
  parseMoneyCurrency,
} = require('./currencies');

function parseReservationCurrency(body = {}) {
  return parseMoneyCurrency(body, { required: false });
}

module.exports = {
  DEFAULT_USD_EGP_RATE,
  MONEY_CURRENCIES,
  parseReservationCurrency,
};
