export const VAT_OUTPUT_PCT = 14;
export const WHT_STANDARD_PCT = 3;
export const WHT_REDUCED_PCT = 1;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function outputVatExclusive(netAmount, ratePct = VAT_OUTPUT_PCT) {
  const base = Math.max(0, Number(netAmount) || 0);
  return round2(base * (ratePct / 100));
}

export function extractInputVat(grossAmount, ratePct = VAT_OUTPUT_PCT) {
  const gross = Math.max(0, Number(grossAmount) || 0);
  const vat = round2((gross * ratePct) / (100 + ratePct));
  return { gross: round2(gross), vat, net: round2(gross - vat) };
}

export function outputVatOnCommission(commissionBase) {
  const base = Math.max(0, Number(commissionBase) || 0);
  return {
    rate_pct: VAT_OUTPUT_PCT,
    taxable_base: round2(base),
    vat_amount: outputVatExclusive(base),
    account_code: '205000',
  };
}

export function outputVatOnTaxableFees(commission, cleaning) {
  const c = Math.max(0, Number(commission) || 0);
  const k = Math.max(0, Number(cleaning) || 0);
  const commissionVat = outputVatExclusive(c);
  const cleaningVat = outputVatExclusive(k);
  return {
    rate_pct: VAT_OUTPUT_PCT,
    commission_vat: commissionVat,
    cleaning_vat: cleaningVat,
    vat_amount: round2(commissionVat + cleaningVat),
    taxable_base: round2(c + k),
    account_code: '205000',
  };
}

export function withholdingTax(vendorBillAmount, { ratePct = WHT_STANDARD_PCT } = {}) {
  const base = Math.max(0, Number(vendorBillAmount) || 0);
  const rate = Number(ratePct) === WHT_REDUCED_PCT ? WHT_REDUCED_PCT : WHT_STANDARD_PCT;
  return {
    rate_pct: rate,
    vendor_base: round2(base),
    wht_amount: round2(base * (rate / 100)),
    account_code: '206000',
  };
}
