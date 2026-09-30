import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Upload } from 'lucide-react';
import api from '../api/axios';
import ListingDatePicker, {
  isoToLocalDate,
  localDateToIso,
} from '../../components/listing/ListingDatePicker';
import { housekeepingFeeForUnit } from '../../utils/housekeeping';
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
  unitSelectLabel,
} from '../utils/formatters';
import {
  appliedPctLabel,
  calcReservationFinancials,
  commissionModeLabel,
} from '../utils/commission';
import { occupancyFromRanges } from '../../utils/stayNights';

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
  housekeeping_fees: '',
  insurance: '',
  booking_source: '',
  sales_person_id: '',
  is_owner_reservation: false,
  notes: '',
  owner_collected_type: '',
  owner_collected_amount: '',
  utilities_cost_override: '',
  beach_access_fees: '',
  broker_name: '',
  broker_amount_per_night: '',
  payment_method: 'cash',
};

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
  showCommission = false,
  allowPastDates = false,
  onCancel,
  onSubmit,
  submitting = false,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { canReserveLongTermUnits } = usePermissions();
  const bookableUnits = useMemo(
    () =>
      canReserveLongTermUnits ? units : units.filter((unit) => unit.listing_type !== 'long_term'),
    [units, canReserveLongTermUnits]
  );
  const selectedUnit = units.find((unit) => String(unit.id) === String(form.unit_id));
  // Staff bookings skip the project minimum stay; long-term units keep their own (holds/owner stays exempt).
  const minNights =
    selectedUnit?.listing_type === 'long_term' && !form.is_owner_reservation && !form.is_hold
      ? Math.max(1, Number(selectedUnit.min_nights) || 1)
      : 1;

  const { data: reservedRanges = [], isLoading: availabilityLoading } = useQuery({
    queryKey: ['manual-blocked-dates', form.unit_id],
    queryFn: () =>
      api
        .get('/reservations/blocked-dates', { params: { unit_id: form.unit_id } })
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

  const defaultHousekeeping = selectedUnit ? housekeepingFeeForUnit(selectedUnit) : 0;
  const housekeeping =
    form.housekeeping_fees !== '' && form.housekeeping_fees != null
      ? Number(form.housekeeping_fees) || 0
      : defaultHousekeeping;
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
  const total = Number(form.total_amount) || 0;
  const downPayment = Number(form.down_payment) || 0;
  const insurance = Number(form.insurance) || 0;
  const ownerCollected = Number(form.owner_collected_amount) || 0;
  const brokerPerNight = Number(form.broker_amount_per_night) || 0;
  const brokerTotal = brokerPerNight * nights;
  const utilitiesPerNight = form.is_owner_reservation
    ? 0
    : Number(form.utilities_cost_override || selectedUnit?.utilities_cost) || 0;
  const utilitiesAmount = utilitiesPerNight * nights;
  const fullBill = Math.round((total + housekeeping + beachAccessFees + insurance + utilitiesAmount) * 100) / 100;
  const commissionFinancials = selectedUnit
    ? calcReservationFinancials(selectedUnit, {
        ...form,
        nights,
        broker_total: brokerTotal,
        utilities_amount: utilitiesAmount,
      })
    : null;

  let toCollect = fullBill - downPayment;
  if (form.owner_collected_type === 'full') toCollect = housekeeping + insurance - downPayment;
  if (form.owner_collected_type === 'partial') toCollect = fullBill - ownerCollected - downPayment;
  toCollect = Math.max(0, toCollect);

  useEffect(() => {
    if (!selectedUnit) return;
    const fee = housekeepingFeeForUnit(selectedUnit);
    setForm((cur) =>
      Number(cur.housekeeping_fees) === fee ? cur : { ...cur, housekeeping_fees: String(fee) }
    );
  }, [selectedUnit?.id, setForm]);

  useEffect(() => {
    const next = form.is_owner_reservation ? 0 : beachAccessFees;
    setForm((cur) =>
      Number(cur.beach_access_fees) === next
        ? cur
        : { ...cur, beach_access_fees: String(next) }
    );
  }, [beachAccessFees, form.is_owner_reservation, setForm]);

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
    setForm((cur) => ({
      ...cur,
      unit_id: value,
      check_in: '',
      check_out: '',
      price_per_night: '',
      total_amount: '',
    }));
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
      <div className="space-y-5">
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
          </div>

          <div>
            <Label>Check-in / Check-out <span className="text-[#ff7a59]">*</span></Label>
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label>Nights</Label>
              <div className={`${fieldClass} bg-[#f6f8fb] font-semibold`}>
                {nights || '—'}
              </div>
            </div>
            <div>
              <Label>Price / night <span className="text-[#ff7a59]">*</span></Label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price_per_night}
                onChange={(e) => setPricePerNight(e.target.value)}
                className={fieldClass}
                placeholder="EGP"
              />
            </div>
            <div>
              <Label>Total (EGP) <span className="text-[#ff7a59]">*</span></Label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.total_amount}
                onChange={(e) => setTotalAmount(e.target.value)}
                className={fieldClass}
                placeholder="EGP"
              />
            </div>
            <div>
              <Label>Housekeeping (EGP)</Label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.housekeeping_fees}
                onChange={(e) =>
                  setForm((cur) => ({ ...cur, housekeeping_fees: e.target.value }))
                }
                className={fieldClass}
                placeholder={defaultHousekeeping ? String(defaultHousekeeping) : '0'}
              />
              {selectedUnit && (
                <p className="mt-1 text-[11px] text-[#8b97aa]">
                  Unit default {money(defaultHousekeeping)} — edit if this stay differs
                </p>
              )}
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

          {selectedUnit && !form.is_owner_reservation && beachAccessFees > 0 && (
            <div className="rounded-[10px] border border-[#e6ebf2] bg-white px-3 py-2.5 text-xs text-[#5b6b80]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-[#0f1c2e]">Beach access</span>
                <strong className="tabular-nums text-[#0f1c2e]">{money(beachAccessFees)}</strong>
              </div>
              <p className="mt-1.5 leading-5">
                {beachIsFlat
                  ? 'Flat stay fee (not per person).'
                  : `Adults × ${money(beachFeeInfo.beach?.adult || 0)} + children × ${money(
                      beachFeeInfo.beach?.extra || 0
                    )} (nanny excluded).`}
              </p>
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
                options={[
                  { value: '', label: 'Select source…' },
                  ...BOOKING_SOURCES.map((source) => ({ value: source, label: source })),
                ]}
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
                  options={[
                    { value: '', label: 'None' },
                    ...users.map((user) => ({ value: String(user.id), label: user.full_name })),
                  ]}
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
                Mark owner stays and skip utilities deduction.
              </span>
            </span>
          </label>

          <hr className="border-[#e6ebf2]" />

          <div className="-mb-2 text-[11.5px] font-bold uppercase tracking-wider text-[#5b6b80]">
            {showCommission ? 'Payment & commission' : 'Payment'}
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
              <Label>Down payment</Label>
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
              <Label>Insurance</Label>
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
              <Label>Broker amount / night</Label>
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
              Broker total: <strong>{nights ? money(brokerTotal) : 'select dates'}</strong>
              {nights > 0 && (
                <> · Net nightly rate after broker: <strong>{money(Math.max(0, Number(form.price_per_night) - brokerPerNight))}</strong></>
              )}
            </p>
          )}

          {showCommission && selectedUnit && (
            <div className="rounded-[10px] border border-[#dbe7f8] bg-[#eef4ff] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#0f1c2e]">Company commission</p>
                  <p className="mt-0.5 text-[12px] text-[#5b6b80]">
                    {commissionModeLabel(selectedUnit)}
                  </p>
                </div>
                <span className="whitespace-nowrap rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#1e5fbf]">
                  {appliedPctLabel(commissionFinancials, selectedUnit)}
                </span>
              </div>
              {nights > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
                  <span className="text-[#5b6b80]">Company commission</span>
                  <strong className="text-right text-[#0f1c2e]">
                    {money(commissionFinancials?.companyCommission)}
                  </strong>
                  <span className="text-[#5b6b80]">Estimated owner net</span>
                  <strong className="text-right text-[#0f7d3a]">
                    {money(commissionFinancials?.ownerNet)}
                  </strong>
                  {commissionFinancials?.tenantDeduction > 0 && (
                    <>
                      <span className="text-[#5b6b80]">Tenant deduction</span>
                      <strong className="text-right text-[#0f1c2e]">
                        {money(commissionFinancials.tenantDeduction)}
                      </strong>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            className="flex w-full items-center justify-between rounded-[10px] border border-[#e6ebf2] px-3 py-2.5 text-sm font-semibold text-[#1e5fbf] hover:bg-[#eef4ff]"
          >
            Owner collection & utilities
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
                    <Label>Amount collected</Label>
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
              {!form.is_owner_reservation && (
                <div>
                  <Label>Utilities override / night</Label>
                  <input
                    type="number"
                    min="0"
                    className={fieldClass}
                    value={form.utilities_cost_override}
                    onChange={(event) =>
                      setForm((cur) => ({
                        ...cur,
                        utilities_cost_override: event.target.value,
                      }))
                    }
                    placeholder={
                      selectedUnit?.utilities_cost
                        ? `Default ${selectedUnit.utilities_cost}`
                        : 'Unit default'
                    }
                  />
                </div>
              )}
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
            <label className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-[#e6ebf2] px-3 py-2.5 text-sm text-[#5b6b80] hover:border-[#1e5fbf] hover:bg-[#eef4ff]">
              <Upload className="h-4 w-4" />
              <span>{transferProof?.name || 'Upload image or PDF (optional)'}</span>
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
              <strong className="text-[#0f1c2e]">{nights ? money(total) : '—'}</strong>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[#5b6b80]">Housekeeping</span>
              <strong className="text-[#0f1c2e]">{money(housekeeping)}</strong>
            </div>
            {beachAccessFees > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-[#5b6b80]">
                  Beach access
                  {!beachIsFlat && childrenCount > 0 ? ' (incl. extra guests)' : ''}
                </span>
                <strong className="text-[#0f1c2e]">{money(beachAccessFees)}</strong>
              </div>
            )}
            {insurance > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-[#5b6b80]">Insurance</span>
                <strong className="text-[#0f1c2e]">{money(insurance)}</strong>
              </div>
            )}
            {utilitiesAmount > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-[#5b6b80]">Utilities</span>
                <strong className="text-[#0f1c2e]">{money(utilitiesAmount)}</strong>
              </div>
            )}
            <div className="flex justify-between py-1 border-t border-[#e6ebf2] mt-1 pt-2">
              <span className="font-semibold text-[#0f1c2e]">Full bill total</span>
              <strong className="text-[#0f1c2e]">{money(fullBill)}</strong>
            </div>
            {downPayment > 0 && (
              <div className="flex justify-between py-1">
                <span className="text-[#5b6b80]">Down payment</span>
                <strong className="text-[#0f7d3a]">− {money(downPayment)}</strong>
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-[#e6ebf2] pt-3">
              <span className="font-semibold text-[#0f1c2e]">Still to collect</span>
              <strong className="text-base text-[#1e5fbf]">{money(toCollect)}</strong>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              className="rounded-[12px] bg-[#1e5fbf] px-6 py-3 font-semibold text-white hover:bg-[#16489a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Saving…' : 'Create reservation'}
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
            These dates will immediately block the unit calendar after the reservation is created.
          </p>
      </div>
    </div>
  );
}
