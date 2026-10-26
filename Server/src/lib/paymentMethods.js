/** Methods staff and guests can choose. Older rows may still say bank_transfer or paymob_card. */
const PAYMENT_METHODS = ['cash', 'instapay', 'visa'];

function normalizePaymentMethod(raw, fallback = 'cash') {
  const m = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (PAYMENT_METHODS.includes(m)) return m;
  if (
    m === 'card' ||
    m === 'credit_card' ||
    m === 'paymob_card' ||
    m === 'online' ||
    m.includes('visa')
  ) {
    return 'visa';
  }
  if (m.includes('insta') || m === 'bank_transfer' || m.includes('transfer') || m.includes('bank')) {
    return 'instapay';
  }
  if (m.includes('cash')) return 'cash';
  return fallback;
}

module.exports = { PAYMENT_METHODS, normalizePaymentMethod };
