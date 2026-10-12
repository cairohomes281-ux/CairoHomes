import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from './ui/Modal';
import { formatDate } from '../utils/formatters';
import { isoDateOnly } from '../../utils/stayNights';

export function isPlatformStay(reservation) {
  const src = String(reservation?.booking_source || '').trim().toLowerCase();
  return src === 'airbnb' || src === 'booking.com' || src === 'booking' || src === 'bookingcom';
}

function addDays(iso, n) {
  const [y, m, d] = String(isoDateOnly(iso)).split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function ExtendStayModal({ open, onClose, reservation }) {
  const qc = useQueryClient();
  const [nights, setNights] = useState('1');
  const [price, setPrice] = useState('');

  useEffect(() => {
    if (!open || !reservation) return;
    const existing = Number(reservation.price_per_night);
    setNights('1');
    setPrice(existing > 0 ? String(existing) : '');
  }, [open, reservation]);

  const checkIn = reservation?.check_out ? isoDateOnly(reservation.check_out) : '';
  const extra = Math.max(0, parseInt(nights, 10) || 0);
  const nightly = Number(price);
  const checkOut = checkIn && extra > 0 ? addDays(checkIn, extra) : '';
  const total = extra > 0 && nightly > 0 ? Math.round(extra * nightly * 100) / 100 : 0;
  const airbnb = String(reservation?.booking_source || '').trim().toLowerCase() === 'airbnb';

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/reservations', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['blocked-dates'] });
      toast.success(airbnb ? 'Extension created and marked paid' : 'Extension created');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not create the extension'),
  });

  const submit = () => {
    if (!reservation) return;
    if (!checkIn) return toast.error('This stay has no check-out date');
    if (extra < 1) return toast.error('Enter how many extra nights');
    if (!(nightly > 0)) return toast.error('Enter the price per night');
    const adults = Math.max(1, parseInt(reservation.adults, 10) || 0);
    createMutation.mutate({
      unit_id: reservation.unit_id,
      guest_name: reservation.guest_name || '',
      guest_phone: reservation.guest_phone || '',
      guest_email: reservation.guest_email || '',
      guest_nationality: reservation.guest_nationality || '',
      adults,
      children: Math.max(0, parseInt(reservation.children, 10) || 0),
      nanny_count: Math.max(0, parseInt(reservation.nanny_count, 10) || 0),
      check_in: checkIn,
      check_out: checkOut,
      price_per_night: nightly,
      total_amount: total,
      booking_source: reservation.booking_source,
      sales_person_id: reservation.sales_person_id || '',
      payment_method: 'cash',
      beach_access_fees: 0,
      insurance: 0,
      notes: reservation.id ? `Extension of reservation #${reservation.id}` : 'Extension',
      currency: 'EGP',
      exchange_rate: 1,
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
          <button type="button" className="btn-primary" disabled={createMutation.isPending} onClick={submit}>
            {createMutation.isPending ? 'Creating…' : 'Create extension'}
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
              New check-in {checkIn ? formatDate(checkIn) : '—'}
              {checkOut ? ` · check-out ${formatDate(checkOut)}` : ''}
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
            <label className="label">Price per night (EGP)</label>
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
            Total {total > 0 ? `EGP ${total.toLocaleString('en-EG')}` : '—'}
            {airbnb ? ' · marked paid' : ''}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
