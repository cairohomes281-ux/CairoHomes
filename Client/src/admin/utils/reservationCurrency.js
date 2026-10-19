import { currency } from './formatters';

/** Currencies staff can agree / collect in. Amounts are stored in EGP. */
export const MONEY_CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR'];

/** Form fields the user types in the reservation's currency (stored in EGP). */
const MONEY_FIELDS = [
  'price_per_night',
  'total_amount',
  'down_payment',
  'insurance',
  'owner_collected_amount',
  'broker_amount_per_night',
];

export function reservationCurrencyCode(r) {
  const code = String(r?.currency || 'EGP').trim().toUpperCase();
  return MONEY_CURRENCIES.includes(code) ? code : 'EGP';
}

export function reservationRate(r) {
  const rate = Number(r?.exchange_rate);
  const code = reservationCurrencyCode(r);
  return code !== 'EGP' && rate > 0 ? rate : 1;
}

/** Formats a stored EGP amount in the reservation's own currency. */
export function reservationMoney(amountEgp, r) {
  return currency((Number(amountEgp) || 0) / reservationRate(r), reservationCurrencyCode(r));
}

const round2 = (n) => Math.round(n * 100) / 100;

function convertFields(form, factor) {
  const out = { ...form };
  for (const key of MONEY_FIELDS) {
    const v = out[key];
    if (v === '' || v == null || Number.isNaN(Number(v))) continue;
    out[key] = String(round2(Number(v) * factor));
  }
  return out;
}

/** Returns an error message when a foreign-currency form has no usable exchange rate. */
export function reservationCurrencyError(form) {
  const code = String(form.currency || 'EGP').toUpperCase();
  if (code === 'EGP') return null;
  const rate = Number(form.exchange_rate);
  return rate > 0 ? null : `Enter the ${code} exchange rate (EGP per 1 ${code})`;
}

/** Form values (typed in the chosen currency) → API payload in EGP. */
export function toEgpPayload(form) {
  const code = String(form.currency || 'EGP').toUpperCase();
  if (code === 'EGP' || !MONEY_CURRENCIES.includes(code)) {
    return { ...form, currency: 'EGP', exchange_rate: 1 };
  }
  const rate = Number(form.exchange_rate);
  return { ...convertFields(form, rate), currency: code, exchange_rate: rate };
}

/** Stored reservation (EGP) → form values in the reservation's currency. */
export function fromEgpFormValues(form, r) {
  const code = reservationCurrencyCode(r);
  const rate = reservationRate(r);
  const out = code !== 'EGP' ? convertFields(form, 1 / rate) : { ...form };
  return { ...out, currency: code, exchange_rate: code !== 'EGP' ? String(rate) : '' };
}

export function egpFromForeign(amount, rate) {
  return round2((Number(amount) || 0) * (Number(rate) > 0 ? Number(rate) : 1));
}

export function foreignFromEgp(amountEgp, rate) {
  const r = Number(rate) > 0 ? Number(rate) : 1;
  return round2((Number(amountEgp) || 0) / r);
}
