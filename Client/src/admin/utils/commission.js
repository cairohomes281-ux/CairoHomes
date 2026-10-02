

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function rentalBase(reservation) {
  const nights = Math.max(parseInt(reservation.nights, 10) || 1, 1);
  const pricePerNight = parseFloat(reservation.price_per_night) || 0;
  if (pricePerNight > 0) return round2(pricePerNight * nights);
  return round2(parseFloat(reservation.total_amount) || 0);
}

function isOwnerReservation(reservation) {
  return Boolean(
    parseInt(reservation.is_owner_reservation, 10) || reservation.is_owner_reservation === true
  );
}

export function calcReservationFinancials(reservation) {
  if (!reservation) return nullFinancials();

  if (String(reservation.status || '').toLowerCase() === 'cancelled') {
    return { ...nullFinancials(), isOwner: isOwnerReservation(reservation), cancelled: true };
  }

  const nights = Math.max(parseInt(reservation.nights, 10) || 1, 1);
  const base = rentalBase(reservation);
  let brokerDeduction = parseFloat(reservation.broker_total) || 0;
  if (!(brokerDeduction > 0)) {
    const brokerNight = parseFloat(reservation.broker_amount_per_night) || 0;
    if (brokerNight > 0) brokerDeduction = round2(brokerNight * nights);
  }

  const ownerNet = round2(Math.max(0, base - brokerDeduction));

  return {
    grossAmount: base,
    rentalBase: base,
    brokerDeduction,
    ownerNet,
    adjustedPricePerNight: nights > 0 ? round2(ownerNet / nights) : 0,
    isOwner: isOwnerReservation(reservation),
  };
}

function nullFinancials() {
  return {
    grossAmount: 0,
    rentalBase: 0,
    brokerDeduction: 0,
    ownerNet: 0,
    adjustedPricePerNight: 0,
    isOwner: false,
  };
}
