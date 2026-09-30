import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRightLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from './ui/Modal';
import SearchableSelect from './ui/SearchableSelect';
import { usePermissions } from '../hooks/usePermissions';
import { currency, formatDate, unitDisplay, unitSelectLabel } from '../utils/formatters';

export default function TransferReservationModal({
  open,
  reservation,
  units = [],
  onClose,
  onTransferred,
}) {
  const [unitId, setUnitId] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open || !reservation) return;
    setUnitId('');
    setCheckIn(String(reservation.check_in || '').slice(0, 10));
    setCheckOut(String(reservation.check_out || '').slice(0, 10));
    setPromoInput('');
    setPromoCode('');
    setReason('');
  }, [open, reservation?.id]);

  const { canReserveLongTermUnits } = usePermissions();
  const unitOptions = useMemo(
    () =>
      (units || [])
        .filter((u) => canReserveLongTermUnits || u.listing_type !== 'long_term')
        .map((u) => ({ value: String(u.id), label: unitSelectLabel(u) })),
    [units, canReserveLongTermUnits]
  );

  const previewEnabled = open && Boolean(reservation?.id && unitId && checkIn && checkOut);

  const {
    data: preview,
    error: previewError,
    isFetching: previewLoading,
  } = useQuery({
    queryKey: ['reservation-transfer-preview', reservation?.id, unitId, checkIn, checkOut, promoCode],
    queryFn: () =>
      api
        .post(`/reservations/${reservation.id}/transfer/preview`, {
          unit_id: unitId,
          check_in: checkIn,
          check_out: checkOut,
          promo_code: promoCode || undefined,
        })
        .then((r) => r.data),
    enabled: previewEnabled,
    retry: false,
  });

  const previewErrText = previewError?.response?.data?.error || (previewError ? 'Could not price this move' : '');

  const transferMutation = useMutation({
    mutationFn: () =>
      api.post(`/reservations/${reservation.id}/transfer`, {
        unit_id: unitId,
        check_in: checkIn,
        check_out: checkOut,
        promo_code: promoCode || undefined,
        reason: reason || undefined,
      }),
    onSuccess: (res) => {
      toast.success(`Moved to ${preview?.to?.unit_number || 'new unit'} as #${res.data?.reservation?.id}`);
      onTransferred?.(res.data);
      onClose?.();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Transfer failed'),
  });

  const applyPromo = () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) {
      setPromoCode('');
      return;
    }
    setPromoCode(code);
  };

  const to = preview?.to;
  const docsCount = Array.isArray(reservation?.id_photo_urls)
    ? reservation.id_photo_urls.filter(Boolean).length
    : Number(preview?.from?.documents) || 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Move to another unit"
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!to || previewLoading || transferMutation.isPending}
            onClick={() => transferMutation.mutate()}
          >
            <ArrowRightLeft className="w-4 h-4" />
            {transferMutation.isPending ? 'Moving…' : 'Cancel & create new stay'}
          </button>
        </>
      }
    >
      {!reservation ? null : (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            This cancels reservation #{reservation.id} and creates a new one with the same guest,
            documents{docsCount ? ` (${docsCount})` : ''}, and payments. Schedule nights on the old
            unit are released.
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm grid grid-cols-2 gap-2">
            <div>
              <div className="text-xs text-gray-500">Current unit</div>
              <div className="font-medium text-gray-900">{unitDisplay(reservation)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Guest</div>
              <div className="font-medium text-gray-900">{reservation.guest_name || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Stay</div>
              <div>
                {formatDate(reservation.check_in)} → {formatDate(reservation.check_out)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Paid so far</div>
              <div className="tabular-nums">{currency(reservation.amount_paid)}</div>
            </div>
          </div>

          <div>
            <label className="label">New unit *</label>
            <SearchableSelect
              value={unitId}
              onChange={setUnitId}
              placeholder="Select available unit…"
              options={[{ value: '', label: 'Select unit…' }, ...unitOptions]}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Check-in</label>
              <input
                type="date"
                className="input"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Check-out</label>
              <input
                type="date"
                className="input"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">Promo code (optional)</label>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                placeholder="Enter code"
              />
              <button type="button" className="btn-secondary whitespace-nowrap" onClick={applyPromo}>
                {promoInput.trim() ? 'Apply' : 'Clear'}
              </button>
            </div>
            {promoCode ? (
              <p className="text-xs text-emerald-700 mt-1">Applying {promoCode}</p>
            ) : null}
          </div>

          <div>
            <label className="label">Reason (optional)</label>
            <textarea
              className="input resize-none"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. AC not working, guest requested another view…"
            />
          </div>

          {previewLoading ? (
            <p className="text-sm text-gray-500">Checking availability and price…</p>
          ) : previewErrText ? (
            <p className="text-sm text-rose-700">{previewErrText}</p>
          ) : to ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm space-y-1">
              <div className="font-semibold text-emerald-900">
                New stay · {to.unit_number || to.title} · {to.nights} night
                {to.nights === 1 ? '' : 's'}
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-600">Accommodation</span>
                <span className="tabular-nums">{currency(to.accommodation)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-600">Housekeeping</span>
                <span className="tabular-nums">{currency(to.housekeeping_fees)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-600">Beach access</span>
                <span className="tabular-nums">{currency(to.beach_access_fees)}</span>
              </div>
              {Number(to.utilities_amount) > 0 ? (
                <div className="flex justify-between gap-3">
                  <span className="text-gray-600">Utilities</span>
                  <span className="tabular-nums">{currency(to.utilities_amount)}</span>
                </div>
              ) : null}
              {Number(to.insurance) > 0 ? (
                <div className="flex justify-between gap-3">
                  <span className="text-gray-600">Insurance</span>
                  <span className="tabular-nums">{currency(to.insurance)}</span>
                </div>
              ) : null}
              {to.promo ? (
                <div className="flex justify-between gap-3 text-emerald-800">
                  <span>Promo {to.promo.code}</span>
                  <span className="tabular-nums">−{currency(to.discount)}</span>
                </div>
              ) : null}
              <div className="flex justify-between gap-3 border-t border-emerald-200 pt-1 font-semibold">
                <span>New total</span>
                <span className="tabular-nums">{currency(to.total_amount)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-600">Already paid</span>
                <span className="tabular-nums">{currency(to.amount_paid)}</span>
              </div>
              <div className="flex justify-between gap-3 text-amber-800 font-medium">
                <span>Still due</span>
                <span className="tabular-nums">{currency(to.amount_due)}</span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
