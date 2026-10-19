import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from './ui/Modal';
import { formatDate } from '../utils/formatters';
import { reservationCurrencyCode, reservationRate } from '../utils/reservationCurrency';
import { isoDateOnly } from '../../utils/stayNights';

export function isPlatformStay(reservation) {
  const src = String(reservation?.booking_source || '').trim().toLowerCase();
  return (
    src === 'outside channel' ||
    src === 'airbnb' ||
    src === 'booking.com' ||
    src === 'booking' ||
    src === 'bookingcom'
  );
}

function addDays(iso, n) {
  const [y, m, d] = String(isoDateOnly(iso)).split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function nightsBetween(start, end) {
  const [y1, m1, d1] = String(isoDateOnly(start)).split('-').map(Number);
  const [y2, m2, d2] = String(isoDateOnly(end)).split('-').map(Number);
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return 0;
  return Math.max(0, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000));
}

export default function ExtendStayModal({ open, onClose, reservation }) {
  const qc = useQueryClient();
  const [nights, setNights] = useState('1');
  const [price, setPrice] = useState('');

  const currencyCode = reservationCurrencyCode(reservation);
  const rate = reservationRate(reservation);

  useEffect(() => {
    if (!open || !reservation) return;
    const stayNights = nightsBetween(reservation.check_in, reservation.check_out);
    const fromRate = Number(reservation.price_per_night);
    const fromTotal = stayNights > 0 ? Number(reservation.total_amount) / stayNights : 0;
    const existingEgp = fromRate > 0 ? fromRate : fromTotal;
    const shown = rate > 0 ? existingEgp / rate : existingEgp;
    setNights('1');
    setPrice(shown > 0 ? String(Math.round(shown * 100) / 100) : '');
  }, [open, reservation, rate]);

  const stayStart = reservation?.check_in ? isoDateOnly(reservation.check_in) : '';
  const currentCheckout = reservation?.check_out ? isoDateOnly(reservation.check_out) : '';
  const extra = Math.max(0, parseInt(nights, 10) || 0);
  const nightly = Number(price);
  const checkOut = currentCheckout && extra > 0 ? addDays(currentCheckout, extra) : '';
  const added = extra > 0 && nightly > 0 ? Math.round(extra * nightly * 100) / 100 : 0;
  const nightlyStored = currencyCode !== 'EGP' ? nightly * rate : nightly;
  const addedStored = extra > 0 && nightlyStored > 0 ? Math.round(extra * nightlyStored * 100) / 100 : 0;
  const oldTotal = Number(reservation?.total_amount) || 0;
  const newTotalStored = addedStored > 0 ? Math.round((oldTotal + addedStored) * 100) / 100 : oldTotal;
  const currentNights = stayStart && currentCheckout ? nightsBetween(stayStart, currentCheckout) : 0;
  const newNights = currentNights + extra;

  const saveMutation = useMutation({
    mutationFn: (payload) => api.put(`/reservations/${reservation.id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      qc.invalidateQueries({ queryKey: ['reservation'] });
      qc.invalidateQueries({ queryKey: ['reservation-detail'] });
      toast.success('Stay extended');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not extend this stay'),
  });

  const submit = () => {
    if (!reservation?.id) return;
    if (!stayStart || !currentCheckout) return toast.error('This stay has no dates');
    if (extra < 1) return toast.error('Enter how many extra nights');
    if (!(nightly > 0)) return toast.error('Enter the price per night');
    const note = `Extended ${extra} night${extra === 1 ? '' : 's'} to ${checkOut} at ${currencyCode} ${nightly}/night.`;
    const notes = [reservation.notes, note].filter(Boolean).join('\n');
    saveMutation.mutate({
      check_in: stayStart,
      check_out: checkOut,
      total_amount: newTotalStored,
      price_per_night: newNights > 0 ? Math.round((newTotalStored / newNights) * 100) / 100 : nightlyStored,
      booking_source: reservation.booking_source,
      notes,
      extend_stay: true,
    });
  };

  return (
    <Modal
      open={open && !!reservation}
      onClose={onClose}
      title="Extend stay"
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={saveMutation.isPending} onClick={submit}>
            {saveMutation.isPending ? 'Saving…' : 'Extend stay'}
          </button>
        </>
      }
    >
      {reservation ? (
        <div className="space-y-4 text-sm">
          <div className="rounded-2xl border border-ch-line bg-[#f7f9fc] px-4 py-3">
            <p className="font-semibold text-ch-pine">{reservation.guest_name || 'Guest'}</p>
            <p className="mt-0.5 text-xs text-ch-muted">
              {[
                reservation.guest_phone,
                reservation.unit_number || reservation.unit_title || reservation.unit_name,
                reservation.booking_source,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <p className="mt-1 text-xs text-ch-muted">
              Check-out {currentCheckout ? formatDate(currentCheckout) : '—'}
              {checkOut ? ` moves to ${formatDate(checkOut)}` : ''}
            </p>
          </div>
          <div>
            <label className="label">Extra nights</label>
            <input
              type="number"
              min="1"
              className="input"
              value={nights}
              onChange={(e) => setNights(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Price per night ({currencyCode})</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <p className="text-sm font-semibold text-ch-ink">
            Added {added > 0 ? `${currencyCode} ${added.toLocaleString('en-EG')}` : '—'}
            {added > 0 ? ` · stay total ${currencyCode} ${(newTotalStored / rate).toLocaleString('en-EG')}` : ''}
          </p>
          <p className="text-xs text-ch-muted">The extra nights are added to this same stay.</p>
        </div>
      ) : null}
    </Modal>
  );
}
