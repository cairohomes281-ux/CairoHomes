/**
 * Reservation amounts are always stored in EGP. A reservation agreed in USD keeps
 * `currency = 'USD'` and the `exchange_rate` (EGP per 1 USD) used to convert it.
 */
const DEFAULT_USD_EGP_RATE = Number(process.env.USD_EGP_RATE) || 52.43;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * Reads `currency` / `exchange_rate` from a request body.
 * Returns null when the body does not mention a currency (leave it unchanged).
 */
function parseReservationCurrency(body = {}) {
  const raw = body.currency;
  if (raw === undefined || raw === null || raw === '') return null;
  const currency = String(raw).trim().toUpperCase();
  if (currency === 'EGP') return { currency: 'EGP', exchange_rate: 1 };
  if (currency !== 'USD') throw badRequest('Currency must be EGP or USD');
  const rate = Number(body.exchange_rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw badRequest('Enter the USD exchange rate (EGP per 1 USD)');
  }
  return { currency: 'USD', exchange_rate: Math.round(rate * 10000) / 10000 };
}

module.exports = { DEFAULT_USD_EGP_RATE, parseReservationCurrency };
