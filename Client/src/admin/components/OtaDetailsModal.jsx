import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from './ui/Modal';
import { formatDate } from '../utils/formatters';
import { isoDateOnly } from '../../utils/stayNights';

const PLACEHOLDER_NAMES = new Set(['airbnb guest', 'booking.com guest']);

export function otaDetailsNeeded(reservation) {
  const flag = reservation?.ota_details_needed;
  return flag === true || flag === 1 || flag === 't' || flag === 'true';
}

function nightsOf(reservation) {
  const stored = Number(reservation?.nights);
  if (stored > 0) return stored;
  const start = isoDateOnly(reservation?.check_in);
  const end = isoDateOnly(reservation?.check_out);
  const [y1, m1, d1] = String(start).split('-').map(Number);
  const [y2, m2, d2] = String(end).split('-').map(Number);
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return 1;
  return Math.max(1, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000));
}

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

export default function OtaDetailsModal({ open, onClose, reservation }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [price, setPrice] = useState('');
  const [total, setTotal] = useState('');
  const nights = nightsOf(reservation);
  const airbnb = String(reservation?.booking_source || '').trim().toLowerCase() === 'airbnb';

  useEffect(() => {
    if (!open || !reservation) return;
    const currentName = String(reservation.guest_name || '').trim();
    setName(PLACEHOLDER_NAMES.has(currentName.toLowerCase()) ? '' : currentName);
    setPhone(String(reservation.guest_phone || '').trim());
    const nightly = Number(reservation.price_per_night);
    const stayTotal = Number(reservation.total_amount);
    if (nightly > 0) {
      setPrice(String(nightly));
      setTotal(String(stayTotal > 0 ? stayTotal : money(nightly * nightsOf(reservation))));
    } else if (stayTotal > 0) {
      setTotal(String(stayTotal));
      setPrice(String(money(stayTotal / nightsOf(reservation))));
    } else {
      setPrice('');
      setTotal('');
    }
  }, [open, reservation]);

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      reservation?.synthetic_ota_block
        ? api.post('/reservations', {
            ...payload,
            unit_id: reservation.unit_id,
            check_in: isoDateOnly(reservation.check_in),
            check_out: isoDateOnly(reservation.check_out),
            adults: 1,
            status: 'confirmed',
            ota_block_stay: true,
          })
        : api.put(`/reservations/${reservation.id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservations'] });
      qc.invalidateQueries({ queryKey: ['schedule'] });
      qc.invalidateQueries({ queryKey: ['reservation'] });
      toast.success('Guest details saved');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save these details'),
  });

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
    if (!reservation?.id) return;
    const guestName = name.trim();
    const guestPhone = phone.trim();
    if (!guestName || PLACEHOLDER_NAMES.has(guestName.toLowerCase())) {
      return toast.error('Enter the guest name');
    }
    if (!guestPhone) return toast.error('Enter the phone number');
    const nightly = Number(price);
    const stayTotal = Number(total);
    if (!(nightly > 0) && !(stayTotal > 0)) {
      return toast.error('Enter the total or the price per night');
    }
    saveMutation.mutate({
      guest_name: guestName,
      guest_phone: guestPhone,
      price_per_night: nightly > 0 ? money(nightly) : money(stayTotal / nights),
      total_amount: stayTotal > 0 ? money(stayTotal) : money(nightly * nights),
      booking_source: reservation.booking_source,
      fill_ota_details: true,
    });
  };

  return (
    <Modal
      open={open && !!reservation}
      onClose={onClose}
      title="Add guest details"
      size="sm"
      footer={
        <>
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
              {reservation.booking_source || 'Platform'} · {reservation.unit_number || reservation.unit_title || reservation.unit_name || 'Unit'}
            </p>
            <p className="mt-0.5 text-xs text-amber-900">
              {formatDate(reservation.check_in)} → {formatDate(reservation.check_out)} · {nights} night{nights === 1 ? '' : 's'}
            </p>
          </div>
          <div>
            <label className="label">Guest name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
          </div>
          <div>
            <label className="label">Phone number</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+20…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Price / night (EGP)</label>
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
              <label className="label">Total (EGP)</label>
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
          {airbnb ? <p className="text-xs text-ch-muted">Airbnb stays are marked paid for this total.</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}
