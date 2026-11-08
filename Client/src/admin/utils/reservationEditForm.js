import { isoDateOnly } from '../../utils/stayNights';
import { fromEgpFormValues, reservationCurrencyError, toEgpPayload } from './reservationCurrency';

const str = (v, fallback = '') => (v === null || v === undefined ? fallback : String(v));

/** Stored reservation row (EGP) → the manual reservation form, in the reservation's own currency. */
export function reservationToForm(r, { confirmHold = false } = {}) {
  const isHold = confirmHold || !!(r.is_hold || r.status === 'hold');
  return fromEgpFormValues(
    {
      unit_id: str(r.unit_id),
      guest_name: isHold && r.guest_name === 'Hold' ? '' : str(r.guest_name),
      guest_email: str(r.guest_email),
      guest_phone: str(r.guest_phone),
      guest_nationality: str(r.guest_nationality),
      adults: str(r.adults, '2'),
      children: str(r.children, '0'),
      nanny_count: str(r.nanny_count, '0'),
      check_in: isoDateOnly(r.check_in) || '',
      check_out: isoDateOnly(r.check_out) || '',
      price_per_night: str(r.price_per_night),
      total_amount: isHold && !(Number(r.total_amount) > 0) ? '' : str(r.total_amount),
      down_payment: Number(r.down_payment) > 0 ? str(r.down_payment) : '',
      insurance: Number(r.insurance) > 0 ? str(r.insurance) : '',
      booking_source: str(r.booking_source),
      sales_person_id: str(r.sales_person_id),
      is_owner_reservation: Number(r.is_owner_reservation) === 1 || r.is_owner_reservation === true,
      notes: str(r.notes),
      owner_collected_type: str(r.owner_collected_type),
      owner_collected_amount: Number(r.owner_collected_amount) > 0 ? str(r.owner_collected_amount) : '',
      beach_access_fees: str(r.beach_access_fees),
      broker_name: str(r.broker_name),
      broker_amount_per_night: Number(r.broker_amount_per_night) > 0 ? str(r.broker_amount_per_night) : '',
      payment_method: str(r.payment_method, 'cash') || 'cash',
      status: isHold ? 'confirmed' : str(r.status, 'pending'),
      ...(isHold ? { is_hold: false } : {}),
    },
    r
  );
}

/**
 * Validates the form and returns `{ payload }` (amounts in EGP) or `{ error }`.
 * In edit mode, empty money fields are sent as 0 so a cleared value is saved.
 */
export function buildReservationPayload(form, { mode = 'create', salesLocked = false } = {}) {
  if (!form.unit_id || !form.check_in || !form.check_out) {
    return { error: 'Unit and dates are required' };
  }
  if (form.check_out <= form.check_in) return { error: 'Check-out must be after check-in' };
  if (!String(form.guest_name || '').trim()) return { error: 'Guest name is required' };
  // Imported / OTA stays may not have a phone yet; still editable, required on create.
  if (mode === 'create' && !String(form.guest_phone || '').trim()) {
    return { error: 'Mobile number is required' };
  }
  // A locked sales person is set to the signed-in user by the server.
  if (!salesLocked && !form.is_owner_reservation && !form.sales_person_id) {
    return { error: 'Please select a Sales Person or mark as Owner Reservation' };
  }
  const adults = Math.max(0, parseInt(form.adults, 10) || 0);
  const children = Math.max(0, parseInt(form.children, 10) || 0);
  const nannyCount = Math.max(0, parseInt(form.nanny_count, 10) || 0);
  if (!form.is_owner_reservation && adults < 1) return { error: 'At least 1 adult is required' };
  const currencyError = reservationCurrencyError(form);
  if (currencyError) return { error: currencyError };

  const filled = { ...form };
  if (mode === 'edit') {
    for (const key of ['down_payment', 'insurance', 'broker_amount_per_night', 'owner_collected_amount']) {
      if (filled[key] === '' || filled[key] == null) filled[key] = '0';
    }
  }
  const { beach_fee_mode: _beachMode, ...rest } = toEgpPayload(filled);
  const payload = {
    ...rest,
    guest_name: String(form.guest_name).trim(),
    guest_phone: String(form.guest_phone || '').trim(),
    adults,
    children,
    nanny_count: nannyCount,
    beach_access_fees: form.is_owner_reservation
      ? 0
      : form.beach_access_fees !== '' && form.beach_access_fees != null
        ? Number(form.beach_access_fees)
        : undefined,
  };
  return { payload };
}

/** Multipart body for a request that carries a transfer proof file. */
export function reservationFormData(payload, file, { keepEmpty = false } = {}) {
  const fd = new FormData();
  Object.entries(payload).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    if (v === '' && !keepEmpty) return;
    fd.append(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
  });
  if (file) fd.append('transfer_proof', file);
  return fd;
}

/** Human labels for the "what changed" summary in edit mode. */
export const EDIT_FIELD_LABELS = {
  unit_id: 'Unit',
  check_in: 'Check-in',
  check_out: 'Check-out',
  currency: 'Currency',
  exchange_rate: 'Exchange rate',
  price_per_night: 'Price / night',
  total_amount: 'Total',
  guest_name: 'Guest name',
  guest_phone: 'Phone',
  guest_email: 'Email',
  guest_nationality: 'Nationality',
  adults: 'Adults',
  children: 'Children',
  nanny_count: 'Nanny',
  booking_source: 'Booking source',
  sales_person_id: 'Sales person',
  is_owner_reservation: 'Owner reservation',
  status: 'Status',
  payment_method: 'Payment method',
  down_payment: 'Down payment',
  insurance: 'Insurance',
  beach_access_fees: 'Beach access',
  broker_name: 'Broker name',
  broker_amount_per_night: 'Broker / night',
  owner_collected_type: 'Owner collection',
  owner_collected_amount: 'Owner collected amount',
  notes: 'Notes',
};

function sameValue(a, b) {
  const sa = a === null || a === undefined ? '' : String(a).trim();
  const sb = b === null || b === undefined ? '' : String(b).trim();
  if (sa === sb) return true;
  const na = sa === '' ? 0 : Number(sa);
  const nb = sb === '' ? 0 : Number(sb);
  return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 0.005;
}

export function changedFieldLabels(initial, form) {
  if (!initial) return [];
  return Object.keys(EDIT_FIELD_LABELS).filter((key) => {
    if (key === 'is_owner_reservation') return !!initial[key] !== !!form[key];
    return !sameValue(initial[key], form[key]);
  }).map((key) => EDIT_FIELD_LABELS[key]);
}
