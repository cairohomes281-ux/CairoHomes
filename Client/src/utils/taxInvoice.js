export const VAT_RATE = 0.14;

const roundCurrency = (value) => Math.round(Number(value || 0) * 100) / 100;

export const calculateTaxInvoice = ({ subtotal = 0, promoDiscountPercentage = 0 }) => {
  const normalizedSubtotal = roundCurrency(subtotal);
  const promoDiscountAmount = roundCurrency(
    normalizedSubtotal * (Math.max(0, Number(promoDiscountPercentage || 0)) / 100)
  );
  const taxableSubtotal = roundCurrency(Math.max(0, normalizedSubtotal - promoDiscountAmount));
  const taxAmount = roundCurrency(taxableSubtotal * VAT_RATE);
  const finalPrice = roundCurrency(taxableSubtotal + taxAmount);

  return {
    subtotal: normalizedSubtotal,
    promoDiscountAmount,
    taxableSubtotal,
    taxRate: VAT_RATE,
    taxAmount,
    finalPrice,
  };
};
