

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

module.exports = { getUsdEgpRate, FALLBACK_RATE };
