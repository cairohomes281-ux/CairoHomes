

const FALLBACK_RATE = Number(process.env.FX_USD_EGP || process.env.VITE_EGP_USD_RATE || 50);
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; 

let cache = {
  rate: FALLBACK_RATE > 0 ? FALLBACK_RATE : 50,
  fetchedAt: 0,
  source: 'fallback',
};

async function fetchJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchLiveUsdEgp() {
  
  try {
    const data = await fetchJson('https://api.frankfurter.dev/v2/rate/USD/EGP?providers=CBE');
    const rate = Number(data?.rate ?? data?.rates?.EGP);
    if (rate > 0) return { rate, source: 'frankfurter-cbe' };
  } catch (_) {}

  
  try {
    const data = await fetchJson('https://open.er-api.com/v6/latest/USD');
    const rate = Number(data?.rates?.EGP);
    if (rate > 0) return { rate, source: 'open.er-api.com' };
  } catch (_) {}

  
  try {
    const data = await fetchJson(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'
    );
    const rate = Number(data?.usd?.egp);
    if (rate > 0) return { rate, source: 'currency-api' };
  } catch (_) {}

  return null;
}

async function getUsdEgpRate({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.fetchedAt && now - cache.fetchedAt < CACHE_TTL_MS) {
    return {
      usd_egp: cache.rate,
      source: cache.source,
      cached: true,
      fetched_at: new Date(cache.fetchedAt).toISOString(),
    };
  }

  const live = await fetchLiveUsdEgp();
  if (live) {
    cache = { rate: live.rate, fetchedAt: now, source: live.source };
  } else if (!cache.fetchedAt) {
    cache = {
      rate: FALLBACK_RATE > 0 ? FALLBACK_RATE : 50,
      fetchedAt: now,
      source: 'fallback',
    };
  }

  return {
    usd_egp: cache.rate,
    source: cache.source,
    cached: !live,
    fetched_at: new Date(cache.fetchedAt).toISOString(),
  };
}

const crossCache = { rates: null, fetchedAt: 0 };

async function usdCrossRates() {
  const now = Date.now();
  if (crossCache.rates && now - crossCache.fetchedAt < CACHE_TTL_MS) return crossCache.rates;
  try {
    const data = await fetchJson('https://open.er-api.com/v6/latest/USD');
    if (data?.rates && Number(data.rates.EGP) > 0) {
      crossCache.rates = data.rates;
      crossCache.fetchedAt = now;
      return data.rates;
    }
  } catch (_) {}
  return crossCache.rates;
}

/** EGP for 1 unit of `currency`, using the live USD/EGP rate. */
async function getEgpPerUnit(currency) {
  const code = String(currency || 'USD').trim().toUpperCase();
  if (code === 'EGP') {
    return { currency: 'EGP', egp_per_unit: 1, source: 'identity' };
  }
  const usd = await getUsdEgpRate();
  if (code === 'USD') {
    return { currency: 'USD', egp_per_unit: usd.usd_egp, source: usd.source };
  }
  const rates = await usdCrossRates();
  const unitsPerUsd = Number(rates?.[code]);
  if (!(unitsPerUsd > 0) || !(usd.usd_egp > 0)) {
    const err = new Error(`No live rate for ${code}`);
    err.status = 404;
    throw err;
  }
  return {
    currency: code,
    egp_per_unit: Math.round((usd.usd_egp / unitsPerUsd) * 10000) / 10000,
    source: 'open.er-api.com',
    usd_egp: usd.usd_egp,
  };
}

module.exports = { getUsdEgpRate, getEgpPerUnit, FALLBACK_RATE };
