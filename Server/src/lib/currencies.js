/** Currencies staff can use for reservations and ops collection. Amounts stay stored in EGP. */
const MONEY_CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR'];

const DEFAULT_USD_EGP_RATE = Number(process.env.USD_EGP_RATE) || 52.43;

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function normalizeCurrencyCode(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const currency = String(raw).trim().toUpperCase();
  if (!MONEY_CURRENCIES.includes(currency)) {
    throw badRequest(`Currency must be one of: ${MONEY_CURRENCIES.join(', ')}`);
  }
  return currency;
}

/**
 * Parse currency + exchange rate from a request body.
 * `exchange_rate` is always EGP per 1 unit of the foreign currency.
 * Returns null when currency is omitted (leave unchanged).
 */
function parseMoneyCurrency(body = {}, { required = false } = {}) {
  const currency = normalizeCurrencyCode(body.currency);
  if (!currency) {
    if (required) throw badRequest('Choose a currency');
    return null;
  }
  if (currency === 'EGP') return { currency: 'EGP', exchange_rate: 1 };
  const rate = Number(body.exchange_rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw badRequest(`Enter the exchange rate (EGP per 1 ${currency})`);
  }
  return { currency, exchange_rate: Math.round(rate * 10000) / 10000 };
}

function toEgp(amountForeign, exchangeRate) {
  const amount = Number(amountForeign);
  const rate = Number(exchangeRate);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(amount * rate * 100) / 100;
}

function fromEgp(amountEgp, exchangeRate) {
  const amount = Number(amountEgp);
  const rate = Number(exchangeRate);
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round((amount / rate) * 100) / 100;
}

module.exports = {
  MONEY_CURRENCIES,
  DEFAULT_USD_EGP_RATE,
  normalizeCurrencyCode,
  parseMoneyCurrency,
  toEgp,
  fromEgp,
};
