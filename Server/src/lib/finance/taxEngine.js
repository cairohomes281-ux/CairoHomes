
const VAT_OUTPUT_PCT = 14;
const WHT_STANDARD_PCT = 3;
const WHT_REDUCED_PCT = 1;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** 14% on top of a net fee (Egyptian exclusive VAT). */
function outputVatExclusive(netAmount, ratePct = VAT_OUTPUT_PCT) {
  const base = Math.max(0, Number(netAmount) || 0);
  return round2(base * (ratePct / 100));
}

/** Split a gross paid amount into net + input VAT (14/114). */
function extractInputVat(grossAmount, ratePct = VAT_OUTPUT_PCT) {
  const gross = Math.max(0, Number(grossAmount) || 0);
  const vat = round2((gross * ratePct) / (100 + ratePct));
  return { gross: round2(gross), vat, net: round2(gross - vat) };
}

function outputVatOnCommission(commissionBase) {
  const base = Math.max(0, Number(commissionBase) || 0);
  return {
    rate_pct: VAT_OUTPUT_PCT,
    taxable_base: round2(base),
    vat_amount: outputVatExclusive(base),
    account_code: '205000',
  };
}

function outputVatOnTaxableFees(commission, cleaning) {
  const c = Math.max(0, Number(commission) || 0);
  const k = Math.max(0, Number(cleaning) || 0);
  const commissionVat = outputVatExclusive(c);
  const cleaningVat = outputVatExclusive(k);
  return {
    rate_pct: VAT_OUTPUT_PCT,
    commission_net: round2(c),
    cleaning_net: round2(k),
    commission_vat: commissionVat,
    cleaning_vat: cleaningVat,
    vat_amount: round2(commissionVat + cleaningVat),
    taxable_base: round2(c + k),
    account_code: '205000',
  };
}

function withholdingTax(vendorBillAmount, { ratePct = WHT_STANDARD_PCT } = {}) {
  const base = Math.max(0, Number(vendorBillAmount) || 0);
  const rate = Number(ratePct) === WHT_REDUCED_PCT ? WHT_REDUCED_PCT : WHT_STANDARD_PCT;
  return {
    rate_pct: rate,
    vendor_base: round2(base),
    wht_amount: round2(base * (rate / 100)),
    account_code: '206000',
  };
}

function bookingSplit(fin, reservation) {
  const gross = fin.grossAmount || 0;
  const cleaning = fin.housekeepingFees || 0;
  const commission = fin.companyCommission || 0;
  const ownerNet = fin.ownerNet || 0;
  const vat = outputVatOnTaxableFees(commission, cleaning);

  return {
    gross_booking: round2(gross + cleaning),
    accommodation: round2(gross),
    company_commission: round2(commission),
    company_commission_pct: fin.appliedCommissionPct || 0,
    cleaning_fee: round2(cleaning),
    vat_on_commission: vat.vat_amount,
    vat_pct: VAT_OUTPUT_PCT,
    commission_vat: vat.commission_vat,
    cleaning_vat: vat.cleaning_vat,
    owner_trust_credit: round2(ownerNet),
    owner_trust_account: '202000',
    commission_revenue_account: '401000',
    cleaning_revenue_account: '402000',
    guest_name: reservation.guest_name,
    unit_name: reservation.unit_name,
    project: reservation.project,
    check_in: reservation.check_in,
    check_out: reservation.check_out,
    reservation_id: reservation.id,
  };
}

function monthlyTaxLiability({ commissionTotal, cleaningTotal = 0, vendorBills = [], monthLabel }) {
  const vat = outputVatOnTaxableFees(commissionTotal, cleaningTotal);
  const whtLines = vendorBills.map((bill) => ({
    vendor: bill.vendor || bill.description || 'Vendor',
    amount: bill.amount,
    ...withholdingTax(bill.amount, { ratePct: bill.wht_rate_pct }),
  }));
  const totalWht = round2(whtLines.reduce((s, l) => s + l.wht_amount, 0));

  return {
    month: monthLabel,
    output_vat: vat,
    withholding: {
      lines: whtLines,
      total_wht: totalWht,
      account_code: '206000',
    },
    total_tax_liability: round2(vat.vat_amount + totalWht),
  };
}

module.exports = {
  VAT_OUTPUT_PCT,
  WHT_STANDARD_PCT,
  WHT_REDUCED_PCT,
  round2,
  outputVatExclusive,
  extractInputVat,
  outputVatOnCommission,
  outputVatOnTaxableFees,
  withholdingTax,
  bookingSplit,
  monthlyTaxLiability,
};
