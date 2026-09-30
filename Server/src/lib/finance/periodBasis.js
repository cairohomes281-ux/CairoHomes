const { AsyncLocalStorage } = require('async_hooks');

/** Which reservation date puts a stay into a financial period. */
const STAY = 'stay';
const CREATED = 'created';

const store = new AsyncLocalStorage();

function normalizePeriodBasis(value) {
  return String(value || '').trim().toLowerCase() === CREATED ? CREATED : STAY;
}

function runWithPeriodBasis(basis, fn) {
  return store.run({ basis: normalizePeriodBasis(basis) }, fn);
}

function currentPeriodBasis() {
  return store.getStore()?.basis || STAY;
}

/** SQL date expression for a reservation's period date (`alias` is the table alias, e.g. 'r'). */
function reservationPeriodSql(alias = '') {
  const a = alias ? `${alias}.` : '';
  return currentPeriodBasis() === CREATED ? `${a}created_at::date` : `${a}check_in`;
}

module.exports = {
  STAY,
  CREATED,
  normalizePeriodBasis,
  runWithPeriodBasis,
  currentPeriodBasis,
  reservationPeriodSql,
};
