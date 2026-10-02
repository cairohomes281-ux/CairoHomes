

const GUEST_SERVICE_FEE_PCT = 15;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function rentalBase(reservation) {
  const nights = Math.max(parseInt(reservation.nights, 10) || 1, 1);
  const pricePerNight = parseFloat(reservation.price_per_night) || 0;
  if (pricePerNight > 0) return round2(pricePerNight * nights);
  return round2(parseFloat(reservation.total_amount) || 0);
}


function ownerAccommodationGross(reservation) {
  const nights = Math.max(parseInt(reservation.nights, 10) || 1, 1);
  const total =
    parseFloat(
      reservation.total_amount != null ? reservation.total_amount : reservation.total_egp
    ) || 0;
  const ppn = parseFloat(reservation.price_per_night) || 0;
  const fromPpn = ppn > 0 ? round2(ppn * nights) : 0;

  if (fromPpn > 0) return fromPpn;

  if (total > 0) {
    return round2(total / (1 + GUEST_SERVICE_FEE_PCT / 100));
  }

  return round2(total);
}

function brokerDeductionFor(reservation) {
  const nights = Math.max(parseInt(reservation?.nights, 10) || 1, 1);
  let brokerDeduction = parseFloat(reservation?.broker_total) || 0;
  if (!(brokerDeduction > 0)) {
    const brokerNight = parseFloat(reservation?.broker_amount_per_night) || 0;
    if (brokerNight > 0) brokerDeduction = round2(brokerNight * nights);
  }
  return brokerDeduction;
}

function ownerPortalFinancials(_unit, reservation, { status } = {}) {
  const displayStatus = String(status || reservation?.status || '').toLowerCase();
  const showMoney = displayStatus === 'confirmed' || displayStatus === 'pending';

  if (!showMoney) {
    return { gross: 0, net: 0, showMoney: false };
  }

  const gross = ownerAccommodationGross(reservation);
  const brokerDeduction = brokerDeductionFor(reservation);
  const net = round2(Math.max(0, gross - brokerDeduction));
  return { gross, net, brokerDeduction, showMoney: true };
}

function emptyFinancials(isOwner = false, extra = {}) {
  return {
    grossAmount: 0,
    rentalBase: 0,
    brokerDeduction: 0,
    tenantDeduction: 0,
    subtotal: 0,
    intermediatePricePerNight: 0,
    companyCommission: 0,
    ownerNet: 0,
    adjustedPricePerNight: 0,
    isOwner,
    ...extra,
  };
}

function isOwnerReservation(reservation) {
  return Boolean(
    parseInt(reservation.is_owner_reservation, 10) || reservation.is_owner_reservation === true
  );
}

function calcReservationFinancials(unit, reservation) {
  if (!unit || !reservation) return emptyFinancials();

  if (String(reservation.status || '').toLowerCase() === 'cancelled') {
    return emptyFinancials(isOwnerReservation(reservation), { cancelled: true });
  }

  const nights = Math.max(parseInt(reservation.nights, 10) || 1, 1);
  const base = ownerAccommodationGross(reservation);
  const brokerDeduction = brokerDeductionFor(reservation);
  const ownerNet = round2(Math.max(0, base - brokerDeduction));
  const perNight = nights > 0 ? round2(ownerNet / nights) : 0;

  return {
    grossAmount: base,
    rentalBase: base,
    brokerDeduction,
    tenantDeduction: 0,
    subtotal: ownerNet,
    intermediatePricePerNight: perNight,
    companyCommission: 0,
    ownerNet,
    adjustedPricePerNight: perNight,
    isOwner: isOwnerReservation(reservation),
  };
}

function calcStatementFinancials(unit, reservations) {
  let totalGross = 0;
  let totalSubtotal = 0;
  let totalOwnerNet = 0;

  const rows = (reservations || []).map((r) => {
    const fin = calcReservationFinancials(unit, r);
    totalGross += fin.grossAmount;
    totalSubtotal += fin.subtotal;
    totalOwnerNet += fin.ownerNet;
    return { ...r, _fin: fin };
  });

  return {
    rows,
    totalGross: round2(totalGross),
    totalSubtotal: round2(totalSubtotal),
    totalOwnerNet: round2(totalOwnerNet),
  };
}

module.exports = {
  calcReservationFinancials,
  calcStatementFinancials,
  ownerAccommodationGross,
  ownerPortalFinancials,
  round2,
  rentalBase,
  GUEST_SERVICE_FEE_PCT,
};
