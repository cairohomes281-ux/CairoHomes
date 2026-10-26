const FALLBACK = Number(import.meta.env.VITE_EGP_USD_RATE || 50);
let egpPerUsd = FALLBACK > 0 ? FALLBACK : 50;

export function setDisplayEgpPerUsd(rate) {
  const n = Number(rate);
  if (n > 0) egpPerUsd = n;
}

export function egpToUsd(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n / egpPerUsd) * 100) / 100;
}

export function usdToEgp(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * egpPerUsd * 100) / 100;
}

/** Format a stored amount as USD. Pass code 'USD' when the number is already dollars. */
export function moneyUsd(amount, code = 'EGP') {
  const n = Number(amount || 0);
  const stored = String(code || 'EGP').toUpperCase();
  const usd = stored === 'USD' ? n : n / egpPerUsd;
  const safe = Number.isFinite(usd) ? usd : 0;
  return `USD ${safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
