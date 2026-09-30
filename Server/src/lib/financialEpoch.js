
const FINANCIAL_EPOCH =
  process.env.FINANCIAL_EPOCH || '2026-04-01';

function maxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return String(a) >= String(b) ? a : b;
}


function clampFromDate(fromDate) {
  return maxDate(fromDate || null, FINANCIAL_EPOCH);
}

module.exports = {
  FINANCIAL_EPOCH,
  clampFromDate,
  maxDate,
};
