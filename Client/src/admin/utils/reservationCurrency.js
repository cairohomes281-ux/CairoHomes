import { currency } from './formatters';

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
  return r?.currency === 'USD' ? 'USD' : 'EGP';
}

export function reservationRate(r) {
  const rate = Number(r?.exchange_rate);
  return reservationCurrencyCode(r) === 'USD' && rate > 0 ? rate : 1;
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

/** Returns an error message when a USD form has no usable exchange rate. */
export function reservationCurrencyError(form) {
  if (form.currency !== 'USD') return null;
  const rate = Number(form.exchange_rate);
  return rate > 0 ? null : 'Enter the USD exchange rate (EGP per 1 USD)';
}

/** Form values (typed in the chosen currency) → API payload in EGP. */
export function toEgpPayload(form) {
  if (form.currency !== 'USD') return { ...form, currency: 'EGP', exchange_rate: 1 };
  const rate = Number(form.exchange_rate);
  return { ...convertFields(form, rate), currency: 'USD', exchange_rate: rate };
}

/** Stored reservation (EGP) → form values in the reservation's currency. */
export function fromEgpFormValues(form, r) {
  const code = reservationCurrencyCode(r);
  const rate = reservationRate(r);
  const out = code === 'USD' ? convertFields(form, 1 / rate) : { ...form };
  return { ...out, currency: code, exchange_rate: code === 'USD' ? String(rate) : '' };
}
