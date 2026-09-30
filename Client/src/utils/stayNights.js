/** Stay nights are [check_in, check_out) — the checkout day stays free for the next arrival. */

export function isoDateOnly(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.replace('T', ' ').slice(0, 10);
}

export function addOneDayStr(dateStr) {
  const [y, m, d] = isoDateOnly(dateStr).split('-').map(Number);
  if (!y || !m || !d) return '';
  const next = new Date(y, m - 1, d + 1);
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, '0');
  const dd = String(next.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const HARD_TURNOVER_SOURCES = new Set([
  'manual',
  'owner',
  'csv_import',
  'ch_availability_xlsx',
]);

/**
 * Flatten reservation ranges + extra calendar blocks into occupied nights.
 * Checkout days are not occupied unless another stay already covers that night.
 * Stale leftover blocks on a pure checkout day are ignored (except Schedule / owner holds).
 */
export function occupancyFromRanges(ranges = []) {
  const occupied = new Set();
  const checkoutDays = new Set();
  const extra = [];
  const sourceByDate = {};

  for (const r of ranges) {
    if (r?._guest_block) {
      if (r.source === 'unpriced') continue;
      const d = isoDateOnly(r.date || r.check_in);
      if (d) extra.push({ date: d, source: r.source || '' });
      continue;
    }
    const ci = isoDateOnly(r.check_in);
    const co = isoDateOnly(r.check_out);
    if (!ci || !co || co <= ci) continue;
    for (let cur = ci; cur < co; cur = addOneDayStr(cur)) occupied.add(cur);
    checkoutDays.add(co);
  }

  for (const b of extra) {
    const leftoverTurnover =
      checkoutDays.has(b.date) &&
      !occupied.has(b.date) &&
      !HARD_TURNOVER_SOURCES.has(b.source);
    if (leftoverTurnover) continue;
    occupied.add(b.date);
    if (b.source) sourceByDate[b.date] = b.source;
  }

  return { blockedSet: occupied, checkoutOnlySet: checkoutDays, sourceByDate };
}
