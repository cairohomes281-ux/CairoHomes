import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from './ui/Modal';
import ReservationCurrencyPicker from './ReservationCurrencyPicker';
import { formatDate } from '../utils/formatters';
import { reservationCurrencyError, toEgpPayload } from '../utils/reservationCurrency';
import { isoDateOnly } from '../../utils/stayNights';

const PLACEHOLDER_NAMES = new Set(['airbnb guest', 'booking.com guest', 'outside channel guest']);

export function otaDetailsNeeded(reservation) {
  const flag = reservation?.ota_details_needed;
  return flag === true || flag === 1 || flag === 't' || flag === 'true';
}

function addDays(iso, n) {
  const [y, m, d] = String(isoDateOnly(iso)).split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function nightsBetween(start, end) {
  const [y1, m1, d1] = String(isoDateOnly(start)).split('-').map(Number);
  const [y2, m2, d2] = String(isoDateOnly(end)).split('-').map(Number);
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return 1;
  return Math.max(1, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000));
}

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

export default function OtaDetailsModal({ open, onClose, reservation, onDelete }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [price, setPrice] = useState('');
  const [total, setTotal] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [currencyForm, setCurrencyForm] = useState({ currency: '', exchange_rate: '' });
  const spanIn = isoDateOnly(reservation?.check_in);
  const spanOut = isoDateOnly(reservation?.check_out);
  const nights = checkIn && checkOut && checkIn < checkOut ? nightsBetween(checkIn, checkOut) : 1;
  const currencyChosen = currencyForm.currency === 'USD' || currencyForm.currency === 'EGP';
  const currencyCode = currencyForm.currency === 'USD' ? 'USD' : 'EGP';

  useEffect(() => {
    if (!open || !reservation) return;
    const currentName = String(reservation.guest_name || '').trim();
    setName(PLACEHOLDER_NAMES.has(currentName.toLowerCase()) ? '' : currentName);
    setPhone(String(reservation.guest_phone || '').trim());
    setCheckIn(isoDateOnly(reservation.check_in));
    setCheckOut(isoDateOnly(reservation.check_out));
    setPrice('');
    setTotal('');
    setCurrencyForm({ currency: '', exchange_rate: '' });
  }, [open, reservation]);

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      reservation?.synthetic_ota_block
        ? api.post('/reservations', {
            ...payload,
            unit_id: reservation.unit_id,
            adults: 1,
            status: 'confirmed',
            ota_block_stay: true,
            ota_event_uid: reservation.ota_event_uid,
            ota_span_check_in: spanIn,
            ota_span_check_out: spanOut,
          })
        : api.put(`/reservations/${reservation.id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['reservation'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      toast.success('Guest details saved');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save these details'),
  });

  const retotal = (nightly, nextNights) => {
    if (Number(nightly) > 0) setTotal(String(money(Number(nightly) * nextNights)));
  };

  const onCheckIn = (value) => {
    let nextOut = checkOut;
    if (value && checkOut && value >= checkOut) nextOut = addDays(value, 1);
    if (nextOut && spanOut && nextOut > spanOut) nextOut = spanOut;
    setCheckIn(value);
    setCheckOut(nextOut);
    if (value && nextOut && value < nextOut) retotal(price, nightsBetween(value, nextOut));
  };

  const onCheckOut = (value) => {
    setCheckOut(value);
    if (checkIn && value && checkIn < value) retotal(price, nightsBetween(checkIn, value));
  };

  const onPrice = (value) => {
    setPrice(value);
    const nightly = Number(value);
    if (nightly > 0) setTotal(String(money(nightly * nights)));
  };

  const onTotal = (value) => {
    setTotal(value);
    const stayTotal = Number(value);
    if (stayTotal > 0) setPrice(String(money(stayTotal / nights)));
  };

  const submit = () => {
    if (!reservation?.id && !reservation?.synthetic_ota_block) return;
    const guestName = name.trim();
    const guestPhone = phone.trim();
    if (!checkIn || !checkOut || !(checkIn < checkOut)) {
      return toast.error('Confirm the check-in and check-out');
    }
    if (checkIn < spanIn || checkOut > spanOut) {
      return toast.error('Keep the dates inside the blocked nights');
    }
    if (!guestName || PLACEHOLDER_NAMES.has(guestName.toLowerCase())) {
      return toast.error('Enter the guest name');
    }
    if (!guestPhone) return toast.error('Enter the phone number');
    if (!currencyChosen) return toast.error('Choose EGP or USD before entering the price');
    const nightly = Number(price);
    const stayTotal = Number(total);
    if (!(nightly > 0) && !(stayTotal > 0)) {
      return toast.error('Enter the total or the price per night');
    }
    const currencyError = reservationCurrencyError(currencyForm);
    if (currencyError) return toast.error(currencyError);
    const priced = toEgpPayload({
      ...currencyForm,
      price_per_night: nightly > 0 ? money(nightly) : money(stayTotal / nights),
      total_amount: stayTotal > 0 ? money(stayTotal) : money(nightly * nights),
    });
    saveMutation.mutate({
      guest_name: guestName,
      guest_phone: guestPhone,
      check_in: checkIn,
      check_out: checkOut,
      price_per_night: priced.price_per_night,
      total_amount: priced.total_amount,
      currency: priced.currency,
      exchange_rate: priced.exchange_rate,
      booking_source: 'Outside Channel',
      fill_ota_details: true,
    });
  };

  return (
    <Modal
      open={open && !!reservation}
      onClose={onClose}
      title="Outside Channel reservation"
      size="sm"
      footer={
        <>
          {onDelete ? (
            <button type="button" className="btn-secondary text-rose-700" onClick={onDelete}>
              Delete
            </button>
          ) : null}
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={saveMutation.isPending} onClick={submit}>
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {reservation ? (
        <div className="space-y-4 text-sm">
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="font-semibold text-amber-950">
              Outside Channel · {reservation.unit_number || reservation.unit_title || reservation.unit_name || 'Unit'}
            </p>
            <p className="mt-0.5 text-xs text-amber-900">
              Blocked {formatDate(spanIn)} → {formatDate(spanOut)}. Confirm which nights are this reservation.
              Any nights you leave out stay on the schedule for the next one.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Check-in</label>
              <input
                type="date"
                className="input"
                min={spanIn}
                max={spanOut ? addDays(spanOut, -1) : undefined}
                value={checkIn}
                onChange={(e) => onCheckIn(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Check-out</label>
              <input
                type="date"
                className="input"
                min={checkIn ? addDays(checkIn, 1) : spanIn}
                max={spanOut || undefined}
                value={checkOut}
                onChange={(e) => onCheckOut(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-ch-muted">
            {nights} night{nights === 1 ? '' : 's'} · {formatDate(checkIn)} → {formatDate(checkOut)}
          </p>
          <div>
            <label className="label">Guest name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <label className="label">Phone number</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20…" />
          </div>
          <ReservationCurrencyPicker form={currencyForm} setForm={setCurrencyForm} requireChoice />
          {currencyChosen ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Price / night ({currencyCode})</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={price}
                  onChange={(e) => onPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="label">Total ({currencyCode})</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={total}
                  onChange={(e) => onTotal(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-ch-line bg-ch-ivory px-3 py-2 text-xs text-ch-muted">
              Choose EGP or USD before entering the price.
            </p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
