const { query } = require('../config/db');
const { getMinimumStayNights } = require('../lib/minStay');
const {
  fetchCalendarOccupancyRows,
  fetchStayCheckoutDates,
  mergeOccupancyByDate,
  applyCheckoutTurnover,
} = require('../lib/calendarOccupancy');

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}


function toIsoDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString();
    if (/T00:00:00(\.\d+)?Z$/.test(iso)) return iso.slice(0, 10);
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return null;
}

function nightsBetween(checkin, checkout) {
  const aIso = toIsoDate(checkin);
  const bIso = toIsoDate(checkout);
  if (!aIso || !bIso) return NaN;
  const a = new Date(`${aIso}T00:00:00`);
  const b = new Date(`${bIso}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return NaN;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function addDaysIso(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localIso(d);
}

function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


function todayIsoBusiness(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function eachNight(checkin, checkout) {
  const start = toIsoDate(checkin);
  const nights = nightsBetween(checkin, checkout);
  const out = [];
  if (!start || !Number.isFinite(nights) || nights <= 0) return out;
  for (let i = 0; i < nights; i++) out.push(addDaysIso(start, i));
  return out;
}

async function priceForNight(wpPostId, dateStr) {
  const { rows } = await query(
    `SELECT price, currency, source FROM unit_daily_prices WHERE wp_post_id = $1 AND date = $2`,
    [wpPostId, dateStr]
  );
  return rows[0] || null;
}

async function getDailyPriceMap(wpPostId, from, to) {
  const { rows } = await query(
    `SELECT date::text AS date, price, currency, source
     FROM unit_daily_prices
     WHERE wp_post_id = $1 AND date >= $2 AND date < $3
     ORDER BY date`,
    [wpPostId, from, to]
  );
  const map = {};
  for (const r of rows) map[r.date] = Number(r.price);
  return { map, rows };
}

async function computeFees(unit, { nights, subtotal, adults = 1, teens = 0 }) {
  const { housekeepingFeeForUnit } = require('../lib/housekeeping');
  const { computeBeachAccessFee } = require('../lib/beachAccess');
  const cleaning = housekeepingFeeForUnit(unit);
  const { fee: access, beach } = await computeBeachAccessFee(unit, { nights, adults, teens });
  
  const servicePct = 15;
  const service = Math.round(Number(subtotal || 0) * (servicePct / 100));
  const deposit = Number(unit?.security_deposit_egp || 0);
  const lines = [];
  if (cleaning > 0) lines.push({ key: 'cleaning', label: 'Housekeeping fee', amount: cleaning });
  if (access > 0) lines.push({ key: 'access', label: 'Access cards', amount: access });
  if (service > 0) {
    lines.push({
      key: 'service',
      label: `Service fees + Taxes (${servicePct}%)`,
      amount: service,
    });
  }
  return {
    lines,
    cleaning_fee_egp: cleaning,
    access_fee_egp: access,
    service_fee_egp: service,
    service_fee_percent: servicePct,
    security_deposit_egp: deposit,
    fees_total: cleaning + access + service,
    beach_access: beach,
  };
}


async function quoteStay({
  wpPostId,
  checkin,
  checkout,
  unit,
  adults = 1,
  teens = 0,
  skipBlockCheck = false,
}) {
  const checkinIso = toIsoDate(checkin);
  const checkoutIso = toIsoDate(checkout);
  if (!checkinIso || !checkoutIso) {
    return { available: false, reason: 'Invalid date range', nights: 0 };
  }

  const nights = nightsBetween(checkinIso, checkoutIso);
  if (!Number.isFinite(nights) || nights <= 0) {
    return { available: false, reason: 'Invalid date range', nights: 0 };
  }

  const minNights = getMinimumStayNights(unit);
  if (nights < minNights) {
    return { available: false, reason: `Minimum stay is ${minNights} nights`, nights };
  }

  if (!skipBlockCheck) {
    const blocked = await getBlockedDates(wpPostId, checkinIso, checkoutIso, { includeUnpriced: false });
    const blockedSet = new Set(blocked.map((b) => b.date));
    for (const dateStr of eachNight(checkinIso, checkoutIso)) {
      if (blockedSet.has(dateStr)) {
        return { available: false, reason: `Date ${dateStr} is unavailable`, nights };
      }
    }
  }

  let baseSubtotal = 0;
  let subtotal = 0;
  const perNight = [];
  const { applyGuestTenantMarkup, guestTenantMarkupPct } = require('../lib/commission');
  const tenantMarkupPct = guestTenantMarkupPct(unit);

  for (const dateStr of eachNight(checkinIso, checkoutIso)) {
    const row = await priceForNight(wpPostId, dateStr);
    if (!row) {
      return { available: false, reason: `No price for ${dateStr}`, nights };
    }
    const basePrice = Number(row.price);
    if (!(basePrice > 0)) {
      return { available: false, reason: `No price for ${dateStr}`, nights };
    }
    const guestPrice = applyGuestTenantMarkup(basePrice, unit);
    baseSubtotal += basePrice;
    subtotal += guestPrice;
    perNight.push({
      date: dateStr,
      price: guestPrice,
      base_price: basePrice,
      currency: row.currency,
    });
  }

  const fees = await computeFees(unit, { nights, subtotal, adults, teens });
  const total = subtotal + fees.fees_total;

  return {
    available: true,
    nights,
    perNight,
    subtotal,
    base_subtotal: roundMoney(baseSubtotal),
    tenant_markup_pct: tenantMarkupPct,
    ...fees,
    total_egp: total,
    currency: unit?.price_currency || 'EGP',
  };
}

async function isDateBlocked(wpPostId, dateStr) {
  const blocked = await getBlockedDates(wpPostId, dateStr, addDaysIso(dateStr, 1));
  return blocked.some((b) => b.date === dateStr);
}


async function getBlockedDates(wpPostId, from, to, { includeUnpriced = true } = {}) {
  const rows = await fetchCalendarOccupancyRows({ from, to, wpPostId });
  const byDate = mergeOccupancyByDate(rows, from, to);

  if (includeUnpriced) {
    const { map } = await getDailyPriceMap(wpPostId, from, to);
    for (let d = new Date(`${from}T00:00:00`); localIso(d) < to; d.setDate(d.getDate() + 1)) {
      const iso = localIso(d);
      if (map[iso] == null && !byDate.has(iso)) byDate.set(iso, 'unpriced');
    }
  }

  const turnover = await fetchStayCheckoutDates({ from, to, wpPostId });
  applyCheckoutTurnover(byDate, turnover);

  return [...byDate.entries()]
    .map(([date, source]) => ({ date, source }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getStayCheckoutDates(wpPostId, from, to) {
  return fetchStayCheckoutDates({ from, to, wpPostId });
}

module.exports = {
  nightsBetween,
  toIsoDate,
  todayIsoBusiness,
  priceForNight,
  getDailyPriceMap,
  quoteStay,
  isDateBlocked,
  getBlockedDates,
  getStayCheckoutDates,
  computeFees,
  eachNight,
  addDaysIso,
  localIso,
};
