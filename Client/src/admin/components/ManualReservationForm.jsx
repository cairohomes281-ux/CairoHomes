import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FileText, RotateCcw, Upload } from 'lucide-react';
import api from '../api/axios';
import ListingDatePicker, {
  isoToLocalDate,
  localDateToIso,
} from '../../components/listing/ListingDatePicker';
import {
  computeBeachAccessFee,
  getGuestLoad,
} from '../../utils/beachAccess';
import SearchableSelect from './ui/SearchableSelect';
import { usePermissions } from '../hooks/usePermissions';
import {
  BOOKING_SOURCES,
  MANUAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  formatDate,
  formatDateTime,
  unitSelectLabel,
} from '../utils/formatters';
import { occupancyFromRanges } from '../../utils/stayNights';
import ReservationCurrencyPicker from './ReservationCurrencyPicker';
import { reservationMoney } from '../utils/reservationCurrency';
import { changedFieldLabels } from '../utils/reservationEditForm';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'checked_in', label: 'Checked in' },
  { value: 'checked_out', label: 'Checked out' },
];

const PAYMENT_STATUS_STYLES = {
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-800 border-amber-200',
  pending: 'bg-rose-50 text-rose-700 border-rose-200',
};

const money = (value) =>
  `EGP ${Number(value || 0).toLocaleString('en-EG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

const fieldClass =
  'w-full rounded-[10px] border border-[#e6ebf2] bg-white px-3 py-2.5 text-sm text-[#0f1c2e] outline-none placeholder:text-[#8b97aa] focus:border-[#1e5fbf] focus:ring-2 focus:ring-[#eef4ff]';

export const EMPTY_MANUAL_RESERVATION_FORM = {
  unit_id: '',
  guest_name: '',
  guest_email: '',
  guest_phone: '',
  guest_nationality: '',
  adults: '2',
  children: '0',
  nanny_count: '0',
  check_in: '',
  check_out: '',
  price_per_night: '',
  total_amount: '',
  down_payment: '',
  insurance: '',
  booking_source: '',
  sales_person_id: '',
  is_owner_reservation: false,
  notes: '',
  owner_collected_type: '',
  owner_collected_amount: '',
  beach_access_fees: '',
  broker_name: '',
  broker_amount_per_night: '',
  payment_method: 'cash',
  currency: 'EGP',
  exchange_rate: '',
};

/** Amount already collected on a stored reservation, in EGP. */
function reservationAmountPaid(r) {
  return Math.max(0, Number(r?.amount_paid) || 0);
}

function Label({ children }) {
  return (
    <p className="mb-1.5 block text-[11.5px] font-bold uppercase tracking-wider text-[#5b6b80]">
      {children}
    </p>
  );
}

export default function ManualReservationForm({
  form,
  setForm,
  units,
  users,
  transferProof,
  onTransferProofChange,
  lockSalesPerson = false,
  currentUserName = '',
  allowPastDates = false,
  onCancel,
  onSubmit,
  submitting = false,
  /** 'create' (default) or 'edit'. */
  mode = 'create',
  /** Full stored reservation row when editing (from GET /reservations/:id). */
  original = null,
  /** Form values the edit started from, for the "what changed" summary. */
  initialForm = null,
  /** Editing a hold to turn it into a confirmed reservation. */
  confirmingHold = false,
}) {
  const isEdit = mode === 'edit';
  const editId = isEdit ? original?.id : null;
  const [showAdvanced, setShowAdvanced] = useState(
    () => isEdit && Boolean(form.owner_collected_type)
  );
  const { canReserveLongTermUnits, isAdmin } = usePermissions();
  const bookableUnits = useMemo(() => {
    const list = canReserveLongTermUnits
      ? units
      : units.filter((unit) => unit.listing_type !== 'long_term');
    // Keep the reservation's current unit selectable even if it is filtered out.
    if (isEdit && form.unit_id && !list.some((u) => String(u.id) === String(form.unit_id))) {
      const current = units.find((u) => String(u.id) === String(form.unit_id));
      if (current) return [current, ...list];
    }
    return list;
  }, [units, canReserveLongTermUnits, isEdit, form.unit_id]);
  const selectedUnit = units.find((unit) => String(unit.id) === String(form.unit_id));
  // Staff bookings skip the project minimum stay; long-term units keep their own (holds/owner stays exempt).
  const minNights =
    selectedUnit?.listing_type === 'long_term' && !form.is_owner_reservation && !form.is_hold
      ? Math.max(1, Number(selectedUnit.min_nights) || 1)
      : 1;

  const { data: reservedRanges = [], isLoading: availabilityLoading } = useQuery({
    queryKey: ['manual-blocked-dates', form.unit_id, editId || null],
    queryFn: () =>
      api
        .get('/reservations/blocked-dates', {
          // When editing, the reservation's own nights must stay pickable.
          params: { unit_id: form.unit_id, exclude_id: editId || undefined },
        })
        .then((r) => r.data),
    enabled: Boolean(form.unit_id),
    staleTime: 30_000,
  });

  const { blockedDates, checkoutDates, blockedSources } = useMemo(() => {
    const { blockedSet, checkoutOnlySet, sourceByDate } = occupancyFromRanges(
      Array.isArray(reservedRanges) ? reservedRanges : []
    );
    return {
      blockedDates: [...blockedSet],
      checkoutDates: [...checkoutOnlySet].filter((d) => !blockedSet.has(d)),
      blockedSources: sourceByDate,
    };
  }, [reservedRanges]);

  const nights = useMemo(() => {
    if (!form.check_in || !form.check_out) return 0;
    return Math.max(
      0,
      Math.round(
        (new Date(`${form.check_out}T00:00:00`) - new Date(`${form.check_in}T00:00:00`)) /
          86_400_000
      )
    );
  }, [form.check_in, form.check_out]);

  const adultsCount = Math.max(0, parseInt(form.adults, 10) || 0);
  const childrenCount = Math.max(0, parseInt(form.children, 10) || 0);
  const capacity = Number(selectedUnit?.guests || selectedUnit?.capacity) || 0;
  const guestLoad = getGuestLoad(adultsCount, childrenCount);
  const overCapacity = capacity > 0 && guestLoad > capacity;
  const beachFeeInfo = useMemo(() => {
    if (!selectedUnit || form.is_owner_reservation) {
      return { fee: 0, beach: null };
    }
    return computeBeachAccessFee(selectedUnit, {
      nights,
      adults: adultsCount,
      teens: childrenCount,
    });
  }, [selectedUnit, form.is_owner_reservation, nights, adultsCount, childrenCount]);
  const beachAccessFees = Number(beachFeeInfo.fee) || 0;
  const beachIsFlat =
    beachFeeInfo.beach?.billing === 'flat' ||
    beachFeeInfo.beach?.mode === 'flat' ||
    beachFeeInfo.beach?.mode === 'free';
  const currencyCode = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR'].includes(
    String(form.currency || '').toUpperCase()
  )
    ? String(form.currency).toUpperCase()
    : 'EGP';
  const fxRate = currencyCode !== 'EGP' ? Number(form.exchange_rate) || 0 : 1;
  const formMoney = (value) =>
    `${currencyCode} ${Number(value || 0).toLocaleString('en-EG', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`;
  const total = Number(form.total_amount) || 0;
  const downPayment = Number(form.down_payment) || 0;
  const insurance = Number(form.insurance) || 0;
  const ownerCollected = Number(form.owner_collected_amount) || 0;
  const brokerPerNight = Number(form.broker_amount_per_night) || 0;
  const brokerTotal = brokerPerNight * nights;

  // Beach access fee: 'auto' follows the unit rules; 'stored' keeps the saved
  // value of an edited reservation until the stay changes; 'manual' is an admin override.
  const [beachMode, setBeachMode] = useState(isEdit ? 'stored' : 'auto');
  const stayKey = `${form.unit_id}|${nights}|${adultsCount}|${childrenCount}|${form.is_owner_reservation ? 1 : 0}`;
  const firstStayKey = useRef(stayKey);
  useEffect(() => {
    if (beachMode === 'stored' && stayKey !== firstStayKey.current) setBeachMode('auto');
  }, [stayKey, beachMode]);

  useEffect(() => {
    if (beachMode !== 'auto') return;
    const next = form.is_owner_reservation ? 0 : beachAccessFees;
    setForm((cur) =>
      Number(cur.beach_access_fees) === next
        ? cur
        : { ...cur, beach_access_fees: String(next) }
    );
  }, [beachAccessFees, form.is_owner_reservation, setForm, beachMode]);

  // Fee actually on the bill (EGP), whichever mode is active.
  const billedBeachEgp = form.is_owner_reservation
    ? 0
    : beachMode === 'auto'
      ? beachAccessFees
      : Number(form.beach_access_fees) || 0;
  const billedBeach = fxRate > 0 ? billedBeachEgp / fxRate : 0;
  const fullBill = Math.round((total + billedBeach + insurance) * 100) / 100;
  let toCollect = fullBill - downPayment;
  if (form.owner_collected_type === 'full') toCollect = insurance - downPayment;
  if (form.owner_collected_type === 'partial') toCollect = fullBill - ownerCollected - downPayment;
  toCollect = Math.max(0, toCollect);
  const alreadyPaid = isEdit ? reservationAmountPaid(original) : 0;
  const changes = useMemo(
    () => (isEdit ? changedFieldLabels(initialForm, form) : []),
    [isEdit, initialForm, form]
  );
  const salesOptions = useMemo(() => {
    const list = users.map((user) => ({ value: String(user.id), label: user.full_name }));
    if (
      form.sales_person_id &&
      !list.some((o) => o.value === String(form.sales_person_id)) &&
      original?.sales_person_name
    ) {
      list.unshift({ value: String(form.sales_person_id), label: original.sales_person_name });
    }
    return [{ value: '', label: 'None' }, ...list];
  }, [users, form.sales_person_id, original]);
  const sourceOptions = useMemo(() => {
    const list = BOOKING_SOURCES.map((source) => ({ value: source, label: source }));
    if (form.booking_source && !BOOKING_SOURCES.includes(form.booking_source)) {
      list.unshift({ value: form.booking_source, label: form.booking_source });
    }
    return [{ value: '', label: 'Select source…' }, ...list];
  }, [form.booking_source]);
  const datesMoved =
    isEdit &&
    initialForm &&
    (form.check_in !== initialForm.check_in || form.check_out !== initialForm.check_out);
  const unitMoved = isEdit && initialForm && String(form.unit_id) !== String(initialForm.unit_id);

  function setPricePerNight(value) {
    const rate = Number(value);
    setForm((cur) => ({
      ...cur,
      price_per_night: value,
      total_amount:
        nights > 0 && rate >= 0 && value !== ''
          ? (rate * nights).toFixed(2)
          : cur.total_amount,
      owner_collected_amount:
        cur.owner_collected_type === 'full' && nights > 0 && rate >= 0 && value !== ''
          ? (rate * nights).toFixed(2)
          : cur.owner_collected_amount,
    }));
  }

  function setTotalAmount(value) {
    const amount = Number(value);
    setForm((cur) => ({
      ...cur,
      total_amount: value,
      price_per_night:
        nights > 0 && amount >= 0 && value !== ''
          ? (amount / nights).toFixed(2)
          : cur.price_per_night,
      owner_collected_amount:
        cur.owner_collected_type === 'full' ? value : cur.owner_collected_amount,
    }));
  }

  function selectUnit(value) {
    if (isEdit) {
      // Editing: keep dates and agreed price; the server re-checks availability on save.
      setForm((cur) => ({ ...cur, unit_id: value }));
      return;
    }
    setForm((cur) => ({
      ...cur,
      unit_id: value,
      check_in: '',
      check_out: '',
      price_per_night: '',
      total_amount: '',
    }));
  }

  function resetDates() {
    if (!initialForm) return;
    setForm((cur) => ({
      ...cur,
      check_in: initialForm.check_in,
      check_out: initialForm.check_out,
    }));
  }

  // Keep the total in step when the stay length changes (edit mode only;
  // create mode always picks dates before prices).
  const prevNights = useRef(nights);
  useEffect(() => {
    if (!isEdit) return;
    if (prevNights.current === nights) return;
    prevNights.current = nights;
    const rate = Number(form.price_per_night);
    if (nights > 0 && rate > 0) {
      setForm((cur) => ({ ...cur, total_amount: (rate * nights).toFixed(2) }));
    }
  }, [isEdit, nights, form.price_per_night, setForm]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
      <div className="space-y-5">
          {isEdit && original && (
            <div className="rounded-[12px] border border-[#e6ebf2] bg-[#f6f8fb] p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-[#d6e2f5] bg-white px-2.5 py-1 font-semibold text-[#1e5fbf]">
                  #{original.id}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 font-semibold capitalize ${
                    PAYMENT_STATUS_STYLES[original.payment_status] || PAYMENT_STATUS_STYLES.pending
                  }`}
                >
                  Payment: {original.payment_status || 'pending'}
                </span>
                <span className="rounded-full border border-[#e6ebf2] bg-white px-2.5 py-1 font-semibold text-[#0f1c2e]">
                  Collected {reservationMoney(alreadyPaid, original)}
                </span>
                {original.booking_id && (
                  <span className="rounded-full border border-[#e6ebf2] bg-white px-2.5 py-1 font-semibold text-[#5b6b80]">
                    Website booking
                  </span>
                )}
              </div>
              <p className="mt-2.5 text-[12px] text-[#5b6b80]">
                Created {original.created_at ? formatDateTime(original.created_at) : '—'}
                {original.created_by_name ? ` by ${original.created_by_name}` : ''}
                {original.updated_at ? ` · last updated ${formatDateTime(original.updated_at)}` : ''}
              </p>
              <div className="mt-3">
                <Label>Reservation status</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[...STATUS_OPTIONS, ...(isAdmin ? [{ value: 'cancelled', label: 'Cancelled' }] : [])].map(
                    (opt) => {
                      const active = (form.status || 'pending') === opt.value;
                      const danger = opt.value === 'cancelled';
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setForm((cur) => ({ ...cur, status: opt.value }))}
                          className={`rounded-[10px] border px-3 py-2 text-[13px] font-semibold transition ${
                            active
                              ? danger
                                ? 'border-rose-500 bg-rose-50 text-rose-700'
                                : 'border-[#1e5fbf] bg-[#eef4ff] text-[#1e5fbf]'
                              : 'border-[#e6ebf2] bg-white text-[#5b6b80] hover:bg-white/60'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    }
                  )}
                </div>
                {form.status === 'cancelled' && original.status !== 'cancelled' && (
                  <p className="mt-2 rounded-[10px] bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                    Saving as cancelled frees the dates right away and skips the cancellation
                    request / refund flow. Use the cancel action instead if a refund is involved.
                  </p>
                )}
                {confirmingHold && (
                  <p className="mt-2 rounded-[10px] bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                    Confirming this hold: fill in the guest and price, then save to turn it into a reservation.
                  </p>
                )}
              </div>
            </div>
          )}

          <div>
            <Label>Unit <span className="text-[#ff7a59]">*</span></Label>
            <SearchableSelect
              value={form.unit_id}
              onChange={selectUnit}
              placeholder="Search or select a unit…"
              options={[
                { value: '', label: 'Select a unit…' },
                ...bookableUnits.map((unit) => ({
                  value: String(unit.id),
                  label: unitSelectLabel(unit),
                })),
              ]}
            />
            {unitMoved && (
              <p className="mt-2 rounded-[10px] bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                Moving to a different unit keeps the current price. Use <strong>Move unit</strong> from the
                reservation details if you want the new unit's rates and a price difference.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <Label>Check-in / Check-out <span className="text-[#ff7a59]">*</span></Label>
              {datesMoved && (
                <button
                  type="button"
                  onClick={resetDates}
                  className="mb-1.5 inline-flex items-center gap-1 text-[12px] font-semibold text-[#1e5fbf] hover:underline"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Original dates
                </button>
              )}
            </div>
            {isEdit && initialForm?.check_in && (
              <p className="mb-2 text-[12px] text-[#5b6b80]">
                Booked: <strong className="text-[#0f1c2e]">{formatDate(initialForm.check_in)}</strong> →{' '}
                <strong className="text-[#0f1c2e]">{formatDate(initialForm.check_out)}</strong>
                {datesMoved && form.check_in && form.check_out && (
                  <>
                    {' '}· New: <strong className="text-[#1e5fbf]">{formatDate(form.check_in)}</strong> →{' '}
                    <strong className="text-[#1e5fbf]">{formatDate(form.check_out)}</strong>
                  </>
                )}
              </p>
            )}
            {form.unit_id ? (
              <>
                <ListingDatePicker
                  inline
                  allowPastDates={allowPastDates}
                  value={{
                    start: isoToLocalDate(form.check_in),
                    end: isoToLocalDate(form.check_out),
                  }}
                  onChange={({ start, end }) =>
                    setForm((cur) => ({
                      ...cur,
                      check_in: start ? localDateToIso(start) : '',
                      check_out: end ? localDateToIso(end) : '',
                    }))
                  }
                  blockedDates={blockedDates}
                  checkoutDates={checkoutDates}
                  blockedSources={blockedSources}
                  minNights={minNights}
                />
                {availabilityLoading && (
                  <p className="mt-2 text-xs text-[#5b6b80]">Loading availability…</p>
                )}
              </>
            ) : (
              <div className="rounded-[10px] border border-dashed border-[#e6ebf2] bg-[#f6f8fb] px-4 py-8 text-center text-sm text-[#5b6b80]">
                Select a unit to view blocked dates on the calendar.
              </div>
            )}
          </div>

          <ReservationCurrencyPicker
            form={form}
            setForm={setForm}
            inputClass={fieldClass}
            labelClass="mb-1.5 block text-[11.5px] font-bold uppercase tracking-wider text-[#5b6b80]"
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label>Nights</Label>
              <div className={`${fieldClass} bg-[#f6f8fb] font-semibold`}>
                {nights || '—'}
              </div>
            </div>
            <div>
              <Label>Price / night ({currencyCode}) <span className="text-[#ff7a59]">*</span></Label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price_per_night}
                onChange={(e) => setPricePerNight(e.target.value)}
                className={fieldClass}
                placeholder={currencyCode}
              />
            </div>
            <div>
              <Label>Total ({currencyCode}) <span className="text-[#ff7a59]">*</span></Label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.total_amount}
                onChange={(e) => setTotalAmount(e.target.value)}
                className={fieldClass}
                placeholder={currencyCode}
              />
            </div>
          </div>

          <hr className="border-[#e6ebf2]" />

          <div className="-mb-2 text-[11.5px] font-bold uppercase tracking-wider text-[#5b6b80]">
            Guest
          </div>
          <div>
            <Label>Name <span className="text-[#ff7a59]">*</span></Label>
            <input
              value={form.guest_name}
              onChange={(e) => setForm((cur) => ({ ...cur, guest_name: e.target.value }))}
              className={fieldClass}
              placeholder="Guest full name"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Phone <span className="text-[#ff7a59]">*</span></Label>
              <input
                value={form.guest_phone}
                onChange={(e) => setForm((cur) => ({ ...cur, guest_phone: e.target.value }))}
                className={fieldClass}
                placeholder="+20…"
              />
            </div>
            <div>
              <Label>Email</Label>
              <input
                type="email"
                value={form.guest_email}
                onChange={(e) => setForm((cur) => ({ ...cur, guest_email: e.target.value }))}
                className={fieldClass}
                placeholder="optional"
              />
            </div>
          </div>
          <div>
            <Label>Nationality</Label>
            <input
              value={form.guest_nationality}
              onChange={(e) => setForm((cur) => ({ ...cur, guest_nationality: e.target.value }))}
              className={fieldClass}
              placeholder="optional"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Adults {!form.is_owner_reservation ? <span className="text-[#ff7a59]">*</span> : null}</Label>
              <input
                type="number"
                min="0"
                value={form.adults}
                onChange={(e) => setForm((cur) => ({ ...cur, adults: e.target.value }))}
                className={fieldClass}
              />
            </div>
            <div>
              <Label>Children</Label>
              <input
                type="number"
                min="0"
                value={form.children}
                onChange={(e) => setForm((cur) => ({ ...cur, children: e.target.value }))}
                className={fieldClass}
              />
            </div>
            <div>
              <Label>Nanny</Label>
              <input
                type="number"
                min="0"
                value={form.nanny_count}
                onChange={(e) => setForm((cur) => ({ ...cur, nanny_count: e.target.value }))}
                className={fieldClass}
                title="Nannies are not charged beach access"
              />
            </div>
          </div>
          {selectedUnit?.guests != null && (
            <div
              className={`rounded-[10px] border px-3 py-2.5 text-xs ${
                overCapacity
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-[#e6ebf2] bg-[#f6f8fb] text-[#5b6b80]'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">Guest load</span>
                <span className="font-semibold tabular-nums">
                  {guestLoad} / {capacity}
                </span>
              </div>
              <p className="mt-1.5 leading-5">
                Adults count as 1, children as 0.5
                {selectedUnit.has_nanny_room ? ' · capacity includes nanny room' : ''}.
                Nanny is excluded from beach access.
              </p>
              {overCapacity && (
                <p className="mt-1.5 font-semibold">
                  Over capacity — still allowed. Extra guests are charged the higher beach-access /
                  extra-guest rate
                  {beachFeeInfo.beach?.extra > 0
                    ? ` (${money(beachFeeInfo.beach.extra)} per child / extra guest)`
                    : ''}
                  .
                </p>
              )}
            </div>
          )}

          {selectedUnit &&
            !form.is_owner_reservation &&
            (beachAccessFees > 0 || billedBeachEgp > 0 || isAdmin) && (
            <div className="rounded-[10px] border border-[#e6ebf2] bg-white px-3 py-2.5 text-xs text-[#5b6b80]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-[#0f1c2e]">
                  Beach access
                  {beachMode === 'manual' && (
                    <span className="ml-2 rounded-full bg-purple-50 px-2 py-0.5 text-[10.5px] font-bold uppercase text-purple-700">
                      Override
                    </span>
                  )}
                  {beachMode === 'stored' && (
                    <span className="ml-2 rounded-full bg-[#f6f8fb] px-2 py-0.5 text-[10.5px] font-bold uppercase text-[#5b6b80]">
                      Saved
                    </span>
                  )}
                </span>
                {beachMode === 'manual' ? (
                  <span className="flex items-center gap-1.5">
                    <span className="font-semibold">EGP</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.beach_access_fees}
                      onChange={(e) =>
                        setForm((cur) => ({ ...cur, beach_access_fees: e.target.value }))
                      }
                      className="w-28 rounded-[8px] border border-[#e6ebf2] px-2 py-1 text-right text-sm text-[#0f1c2e] outline-none focus:border-[#1e5fbf]"
                    />
                  </span>
                ) : (
                  <strong className="tabular-nums text-[#0f1c2e]">
                    {currencyCode !== 'EGP'
                      ? `${formMoney(billedBeach)} (${money(billedBeachEgp)})`
                      : money(billedBeachEgp)}
                  </strong>
                )}
              </div>
              <p className="mt-1.5 leading-5">
                {beachIsFlat
                  ? 'Flat stay fee (not per person).'
                  : `Adults × ${money(beachFeeInfo.beach?.adult || 0)} + children × ${money(
                      beachFeeInfo.beach?.extra || 0
                    )} (nanny excluded).`}
                {beachMode !== 'auto' && Math.abs(billedBeachEgp - beachAccessFees) > 0.5 && (
                  <> Current rules give {money(beachAccessFees)}.</>
                )}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-3">
                {beachMode !== 'auto' && (
                  <button
                    type="button"
                    onClick={() => setBeachMode('auto')}
                    className="font-semibold text-[#1e5fbf] hover:underline"
                  >
                    Recalculate from unit rules
                  </button>
                )}
                {isAdmin && beachMode !== 'manual' && (
                  <button
                    type="button"
                    onClick={() => setBeachMode('manual')}
                    className="font-semibold text-purple-700 hover:underline"
                  >
                    Set a custom amount
                  </button>
                )}
              </div>
            </div>
          )}

          <hr className="border-[#e6ebf2]" />

          <div className="-mb-2 text-[11.5px] font-bold uppercase tracking-wider text-[#5b6b80]">
            Booking
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Booking source</Label>
              <SearchableSelect
                value={form.booking_source}
                onChange={(value) => setForm((cur) => ({ ...cur, booking_source: value }))}
                placeholder="Select source…"
                options={sourceOptions}
              />
            </div>
            <div>
              <Label>Sales person{!form.is_owner_reservation ? ' *' : ''}</Label>
              {lockSalesPerson ? (
                <div className={`${fieldClass} bg-[#f6f8fb] text-[#5b6b80]`}>
                  {currentUserName || 'Assigned to you'}
                </div>
              ) : (
                <SearchableSelect
                  value={form.sales_person_id}
                  onChange={(value) => setForm((cur) => ({ ...cur, sales_person_id: value }))}
                  placeholder="Select salesperson…"
                  options={salesOptions}
                />
              )}
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-[#e6ebf2] bg-[#f6f8fb] px-3 py-2.5">
            <input
              type="checkbox"
              checked={Boolean(form.is_owner_reservation)}
              onChange={(event) =>
                setForm((cur) => ({ ...cur, is_owner_reservation: event.target.checked }))
              }
              className="mt-0.5 h-4 w-4 accent-[#1e5fbf]"
            />
            <span>
              <span className="block text-sm font-semibold text-[#0f1c2e]">Owner reservation</span>
              <span className="block text-[12.5px] text-[#5b6b80]">
                Mark stays booked by the owner.
              </span>
            </span>
          </label>

          <hr className="border-[#e6ebf2]" />

          <div className="-mb-2 text-[11.5px] font-bold uppercase tracking-wider text-[#5b6b80]">
            Payment
          </div>

          {!form.is_owner_reservation && (
            <div>
              <Label>Payment method</Label>
              <div className="grid grid-cols-2 gap-3">
                {MANUAL_PAYMENT_METHODS.map((method) => {
                  const active = form.payment_method === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setForm((cur) => ({ ...cur, payment_method: method }))}
                      className={`rounded-[10px] border px-3 py-2.5 text-sm font-semibold transition ${
                        active
                          ? 'border-[#1e5fbf] bg-[#eef4ff] text-[#1e5fbf]'
                          : 'border-[#e6ebf2] bg-white text-[#5b6b80] hover:bg-[#f6f8fb]'
                      }`}
                    >
                      {PAYMENT_METHOD_LABELS[method]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Down payment ({currencyCode})</Label>
              <input
                type="number"
                min="0"
                value={form.down_payment}
                onChange={(event) =>
                  setForm((cur) => ({ ...cur, down_payment: event.target.value }))
                }
                className={fieldClass}
                placeholder="0"
              />
            </div>
            <div>
              <Label>Insurance ({currencyCode})</Label>
              <input
                type="number"
                min="0"
                value={form.insurance}
                onChange={(event) =>
                  setForm((cur) => ({ ...cur, insurance: event.target.value }))
                }
                className={fieldClass}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Broker name</Label>
              <input
                value={form.broker_name}
                onChange={(event) =>
                  setForm((cur) => ({ ...cur, broker_name: event.target.value }))
                }
                className={fieldClass}
                placeholder="optional"
              />
            </div>
            <div>
              <Label>Broker amount / night ({currencyCode})</Label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.broker_amount_per_night}
                onChange={(event) =>
                  setForm((cur) => ({ ...cur, broker_amount_per_night: event.target.value }))
                }
                className={fieldClass}
                placeholder="0"
              />
            </div>
          </div>

          {brokerPerNight > 0 && (
            <p className="rounded-[10px] bg-[#faf5ff] px-3 py-2 text-[12.5px] text-purple-800">
              Broker total: <strong>{nights ? formMoney(brokerTotal) : 'select dates'}</strong>
              {nights > 0 && (
                <> · Net nightly rate after broker: <strong>{formMoney(Math.max(0, Number(form.price_per_night) - brokerPerNight))}</strong></>
              )}
            </p>
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="flex w-full items-center justify-between rounded-[10px] border border-[#e6ebf2] px-3 py-2.5 text-sm font-semibold text-[#1e5fbf] hover:bg-[#eef4ff]"
          >
            Owner collection
            <ChevronDown className={`h-4 w-4 transition ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          {showAdvanced && (
            <div className="space-y-4 rounded-[10px] border border-[#e6ebf2] bg-[#f6f8fb] p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label>Owner collected</Label>
                  <select
                    className={fieldClass}
                    value={form.owner_collected_type}
                    onChange={(event) =>
                      setForm((cur) => ({
                        ...cur,
                        owner_collected_type: event.target.value,
                        owner_collected_amount:
                          event.target.value === 'full' ? cur.total_amount : '',
                      }))
                    }
                  >
                    <option value="">No</option>
                    <option value="partial">Partial</option>
                    <option value="full">Full accommodation</option>
                  </select>
                </div>
                {form.owner_collected_type === 'partial' && (
                  <div>
                    <Label>Amount collected ({currencyCode})</Label>
                    <input
                      type="number"
                      min="0"
                      className={fieldClass}
                      value={form.owner_collected_amount}
                      onChange={(event) =>
                        setForm((cur) => ({
                          ...cur,
                          owner_collected_amount: event.target.value,
                        }))
                      }
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <Label>Notes (internal)</Label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm((cur) => ({ ...cur, notes: event.target.value }))}
              className={`${fieldClass} resize-none`}
              placeholder="Payment details, guest requests, or internal notes…"
            />
          </div>

          <div>
            <Label>Transfer proof</Label>
            {isEdit && original?.transfer_proof_path && (
              <a
                href={original.transfer_proof_path}
                target="_blank"
                rel="noreferrer"
                className="mb-2 flex items-center gap-2 rounded-[10px] border border-[#e6ebf2] bg-[#f6f8fb] px-3 py-2 text-sm font-semibold text-[#1e5fbf] hover:bg-[#eef4ff]"
              >
                <FileText className="h-4 w-4" />
                <span className="truncate">
                  Current: {original.transfer_proof_name || 'view file'}
                </span>
              </a>
            )}
            <label className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-[#e6ebf2] px-3 py-2.5 text-sm text-[#5b6b80] hover:border-[#1e5fbf] hover:bg-[#eef4ff]">
              <Upload className="h-4 w-4" />
              <span>
                {transferProof?.name ||
                  (isEdit && original?.transfer_proof_path
                    ? 'Replace with a new image or PDF'
                    : 'Upload image or PDF (optional)')}
              </span>
              <input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(event) => onTransferProofChange?.(event.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div className="rounded-[10px] border border-[#e6ebf2] bg-[#f6f8fb] p-3 text-sm">
            <div className="flex justify-between py-1">
              <span className="text-[#5b6b80]">Accommodation ({nights || '—'} nights)</span>
              <strong className="text-[#0f1c2e]">{nights ? formMoney(total) : '—'}</strong>
            </div>
            {billedBeach > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-[#5b6b80]">
                  Beach access
                  {!beachIsFlat && childrenCount > 0 ? ' (incl. extra guests)' : ''}
                </span>
                <strong className="text-[#0f1c2e]">{formMoney(billedBeach)}</strong>
              </div>
            )}
            {insurance > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-[#5b6b80]">Insurance</span>
                <strong className="text-[#0f1c2e]">{formMoney(insurance)}</strong>
              </div>
            )}
            <div className="flex justify-between py-1 border-t border-[#e6ebf2] mt-1 pt-2">
              <span className="font-semibold text-[#0f1c2e]">Full bill total</span>
              <strong className="text-[#0f1c2e]">{formMoney(fullBill)}</strong>
            </div>
            {downPayment > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-[#5b6b80]">Down payment</span>
                <strong className="text-[#0f7d3a]">− {formMoney(downPayment)}</strong>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-[#e6ebf2] pt-3">
              <span className="font-semibold text-[#0f1c2e]">Still to collect</span>
              <strong className="text-base text-[#1e5fbf]">{formMoney(toCollect)}</strong>
            </div>
            {isEdit && alreadyPaid > 0 && (
              <p className="mt-1 text-right text-xs text-[#5b6b80]">
                {reservationMoney(alreadyPaid, original)} already recorded in payments.
              </p>
            )}
            {currencyCode !== 'EGP' && fxRate > 0 && fullBill > 0 && (
              <p className="mt-2 text-right text-xs text-[#5b6b80]">
                ≈ {money(fullBill * fxRate)} at {fxRate} EGP / {currencyCode}
              </p>
            )}
          </div>

          {isEdit && (
            <div
              className={`rounded-[10px] border px-3 py-2.5 text-[12.5px] ${
                changes.length
                  ? 'border-[#d6e2f5] bg-[#eef4ff] text-[#16489a]'
                  : 'border-[#e6ebf2] bg-[#f6f8fb] text-[#5b6b80]'
              }`}
            >
              {changes.length ? (
                <>
                  <strong>
                    {changes.length} change{changes.length === 1 ? '' : 's'}:
                  </strong>{' '}
                  {changes.join(', ')}
                </>
              ) : (
                'No changes yet.'
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onSubmit}
              disabled={
                submitting || (isEdit && !confirmingHold && !changes.length && !transferProof)
              }
              className="rounded-[12px] bg-[#1e5fbf] px-6 py-3 font-semibold text-white hover:bg-[#16489a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? 'Saving…'
                : confirmingHold
                  ? 'Confirm reservation'
                  : isEdit
                    ? 'Save changes'
                    : 'Create reservation'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="text-sm font-semibold text-[#5b6b80] hover:text-[#0f1c2e]"
            >
              Cancel
            </button>
          </div>

          <p className="text-[12.5px] text-[#5b6b80]">
            {isEdit
              ? 'Date or unit changes re-check availability and update the unit calendar when you save.'
              : 'These dates will immediately block the unit calendar after the reservation is created.'}
          </p>
      </div>
    </div>
  );
}
