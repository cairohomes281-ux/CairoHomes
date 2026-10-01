import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, Maximize2, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import IdDocumentPreviewModal from './IdDocumentPreviewModal';
import Badge from './ui/Badge';
import LoadingSpinner from './ui/LoadingSpinner';
import Modal from './ui/Modal';
import { idDocumentThumbUrl, isPdfUrl } from '../utils/idDocuments';
import { currency, formatDate, PAYMENT_METHOD_LABELS } from '../utils/formatters';
import { resolveWebsiteBookingPayTotals } from '../utils/websiteBookingPay';
function toIdPhotos(booking) {
  if (Array.isArray(booking?.id_photo_urls)) {
    return booking.id_photo_urls.filter(Boolean);
  }
  return [];
}

function partyCount(booking) {
  const party =
    (Number(booking?.adults) || 0) +
    (Number(booking?.children) || 0) +
    (Number(booking?.nanny_count) || 0);
  if (party > 0) return party;
  return booking?.guests != null ? booking.guests : '—';
}

function partyLabel(booking) {
  const adults = Number(booking?.adults);
  const children = Number(booking?.children);
  const nanny = Number(booking?.nanny_count);
  const parts = [];
  if (Number.isFinite(adults) && adults > 0) {
    parts.push(`${adults} adult${adults === 1 ? '' : 's'}`);
  }
  if (Number.isFinite(children) && children > 0) {
    parts.push(`${children} child${children === 1 ? '' : 'ren'}`);
  }
  if (Number.isFinite(nanny) && nanny > 0) {
    parts.push(`${nanny} nanny`);
  }
  if (parts.length) return parts.join(' · ');
  if (booking?.guests != null) return `${booking.guests} guest${Number(booking.guests) === 1 ? '' : 's'}`;
  return '—';
}

function paymentBreakdown(booking) {
  return resolveWebsiteBookingPayTotals(booking?.payment_breakdown || {}, booking);
}

function paymentMethodLabel(method) {
  const key = String(method || '').toLowerCase();
  if (PAYMENT_METHOD_LABELS[key]) return PAYMENT_METHOD_LABELS[key];
  if (key.includes('paymob') || key.includes('card')) return 'Card';
  if (key.includes('instapay')) return 'InstaPay';
  if (key.includes('cash')) return 'Cash';
  return method || '—';
}

function paymentMethodTone(method) {
  const key = String(method || '').toLowerCase();
  if (key.includes('instapay')) return 'bg-violet-100 text-violet-800 border-violet-200';
  if (key.includes('paymob') || key.includes('card')) return 'bg-sky-100 text-sky-800 border-sky-200';
  if (key.includes('cash')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function nightsBetween(checkin, checkout) {
  if (!checkin || !checkout) return 0;
  const ms = new Date(checkout) - new Date(checkin);
  return Math.max(1, Math.round(ms / 86400000));
}

function isPrepaid(booking) {
  const method = String(booking?.payment_method || '').toLowerCase();
  return (
    booking?.payment_status === 'paid' ||
    method.includes('paymob') ||
    method.includes('card')
  );
}

function needsDeposit(booking) {
  return !isPrepaid(booking);
}

function resolveAmountPaid(booking, paymentMode, customAmount, total, halfAmount) {
  if (!booking) return 0;
  if (isPrepaid(booking)) return total;
  if (paymentMode === 'half') return halfAmount;
  if (paymentMode === 'full') return total;
  const n = Number(customAmount);
  return Number.isFinite(n) ? n : 0;
}

export default function WebsiteBookingRequests() {
  const qc = useQueryClient();
  const [previewPhotos, setPreviewPhotos] = useState([]);
  const [previewPhotoIndex, setPreviewPhotoIndex] = useState(0);
  const [acceptBooking, setAcceptBooking] = useState(null);
  const [paymentMode, setPaymentMode] = useState('half');
  const [customAmount, setCustomAmount] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [rejectBooking, setRejectBooking] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['website-bookings-pending'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'pending' } }).then((r) => r.data),
    refetchInterval: 30000,
  });

  const acceptTotal =
    Number(
      resolveWebsiteBookingPayTotals(
        acceptBooking?.payment_breakdown,
        acceptBooking
      ).total_egp ?? acceptBooking?.total_egp
    ) || 0;
  const halfAmount = Math.round(acceptTotal * 0.5 * 100) / 100;
  const amountPaid = resolveAmountPaid(
    acceptBooking,
    paymentMode,
    customAmount,
    acceptTotal,
    halfAmount
  );
  const remaining = Math.max(0, Math.round((acceptTotal - amountPaid) * 100) / 100);

  const acceptMutation = useMutation({
    mutationFn: ({ id, formData }) =>
      api.post(`/website-bookings/${id}/accept`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    onSuccess: () => {
      toast.success('Booking accepted');
      closeAcceptModal();
      qc.invalidateQueries({ queryKey: ['website-bookings-pending'] });
      qc.invalidateQueries({ queryKey: ['website-bookings-history'] });
      qc.invalidateQueries({ queryKey: ['reservations'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Accept failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) =>
      api.post(`/website-bookings/${id}/reject`, { reason }),
    onSuccess: () => {
      toast.success('Booking rejected');
      closeRejectModal();
      qc.invalidateQueries({ queryKey: ['website-bookings-pending'] });
      qc.invalidateQueries({ queryKey: ['website-bookings-history'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Reject failed'),
  });

  const openPreview = (photos, startUrl) => {
    const list = photos.filter(Boolean);
    if (!list.length) return;
    setPreviewPhotos(list);
    setPreviewPhotoIndex(Math.max(0, list.indexOf(startUrl)));
  };

  const openAcceptModal = (booking) => {
    setAcceptBooking(booking);
    setPaymentMode('half');
    setCustomAmount(
      String(
        Math.round(
          (Number(
            resolveWebsiteBookingPayTotals(booking?.payment_breakdown, booking).total_egp ??
              booking.total_egp
          ) || 0) *
            0.5 *
            100
        ) / 100
      )
    );
    setEvidenceFile(null);
  };

  const closeAcceptModal = () => {
    setAcceptBooking(null);
    setEvidenceFile(null);
  };

  const openRejectModal = (booking) => {
    setRejectBooking(booking);
    setRejectReason('');
  };

  const closeRejectModal = () => {
    setRejectBooking(null);
    setRejectReason('');
  };

  const submitReject = () => {
    if (!rejectBooking) return;
    const reason = rejectReason.trim();
    if (!reason) {
      toast.error('Please enter a rejection reason');
      return;
    }
    rejectMutation.mutate({ id: rejectBooking.id, reason });
  };

  const submitAccept = () => {
    if (!acceptBooking) return;

    if (needsDeposit(acceptBooking)) {
      if (!(amountPaid > 0)) {
        toast.error('Enter how much the guest paid');
        return;
      }
      if (amountPaid + 0.009 < halfAmount) {
        toast.error(`Minimum deposit is 50% (${currency(halfAmount)})`);
        return;
      }
      if (amountPaid > acceptTotal + 0.5) {
        toast.error('Paid amount cannot exceed the total');
        return;
      }
      if (!evidenceFile) {
        toast.error('Upload payment evidence to accept');
        return;
      }
    }

    const fd = new FormData();
    if (needsDeposit(acceptBooking)) {
      fd.append('payment_mode', paymentMode);
      fd.append('amount_paid', String(amountPaid));
      if (evidenceFile) fd.append('evidence', evidenceFile);
    }
    acceptMutation.mutate({ id: acceptBooking.id, formData: fd });
  };

  if (isLoading) return <LoadingSpinner />;

  if (!bookings.length) {
    return (
      <div className="card p-8 text-center text-sm text-gray-500">
        No website requests waiting. New bookings from the website will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-4 space-y-3 border-amber-200 bg-amber-50/40">
        <div>
          <h2 className="font-semibold text-gray-900">Website requests awaiting confirmation</h2>
          <p className="text-xs text-gray-500">
            Review guest contact, party size, stay dates, ID photos, and full payment breakdown. For
            InstaPay/Cash, collect at least 50% with evidence before accepting.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 pr-3">Guest contact</th>
                <th className="py-2 pr-3">Guests</th>
                <th className="py-2 pr-3">Duration</th>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3">Payment details</th>
                <th className="py-2 pr-3">Payment method</th>
                <th className="py-2 pr-3">Guest documents</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => {
                const idPhotos = toIdPhotos(b);
                const nights = nightsBetween(b.checkin, b.checkout);
                const methodLabel = paymentMethodLabel(b.payment_method);
                const pay = paymentBreakdown(b);
                const total = Number(pay.total_egp ?? b.total_egp) || 0;
                const paid = Number(pay.amount_paid ?? b.amount_paid) || 0;
                const due = Number(pay.amount_due ?? Math.max(0, total - paid)) || 0;
                return (
                  <tr key={b.id} className="border-t border-amber-100/80 align-top">
                    <td className="py-3 pr-3 min-w-[14rem]">
                      <div className="rounded-lg border border-amber-200/80 bg-white px-3 py-2.5 shadow-sm space-y-1.5">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Name</div>
                          <div className="text-base font-semibold text-gray-900 leading-snug">
                            {b.guest_name || '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Phone</div>
                          <div className="text-sm font-semibold text-gray-800 tabular-nums">
                            {b.guest_phone || <span className="font-normal italic text-rose-600">Missing phone</span>}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Email</div>
                          <div className="text-sm font-medium text-gray-700 break-all">
                            {b.guest_email || <span className="font-normal italic text-rose-600">Missing email</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-3 min-w-[8rem]">
                      <div className="font-semibold text-gray-900">{partyLabel(b)}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{partyCount(b)} total</div>
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap">
                      <div className="font-medium text-gray-900">
                        {nights} night{nights === 1 ? '' : 's'}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {formatDate(b.checkin)} → {formatDate(b.checkout)}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-gray-900">{b.unit_number || '—'}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[10rem]">
                        {b.unit_title || b.listing_title || ''}
                      </div>
                    </td>
                    <td className="py-3 pr-3 min-w-[11rem]">
                      <div className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 space-y-1 text-xs">
                        {pay.subtotal != null && (
                          <div className="flex justify-between gap-3">
                            <span className="text-gray-500">Stay</span>
                            <span className="font-medium tabular-nums">{currency(pay.subtotal)}</span>
                          </div>
                        )}
                        {Number(pay.beach_access_fees) > 0 && (
                          <div className="flex justify-between gap-3">
                            <span className="text-gray-500">Beach access</span>
                            <span className="font-medium tabular-nums">{currency(pay.beach_access_fees)}</span>
                          </div>
                        )}
                        {Number(pay.service_fees) > 0 && (
                          <div className="flex justify-between gap-3">
                            <span className="text-gray-500">
                              Service{pay.service_fee_percent ? ` (${pay.service_fee_percent}%)` : ''}
                            </span>
                            <span className="font-medium tabular-nums">{currency(pay.service_fees)}</span>
                          </div>
                        )}
                        {Number(pay.amount_before_promo) > 0 && Number(pay.promo_discount) > 0 && (
                          <div className="flex justify-between gap-3 border-t border-gray-100 pt-1">
                            <span className="text-gray-500">Before promo</span>
                            <span className="font-medium tabular-nums">
                              {currency(pay.amount_before_promo)}
                            </span>
                          </div>
                        )}
                        {Number(pay.promo_discount) > 0 && (
                          <div className="flex justify-between gap-3 text-emerald-700">
                            <span>
                              Promo
                              {pay.promo_code ? ` ${pay.promo_code}` : ''}
                              {pay.promo_discount_percent ? ` (−${pay.promo_discount_percent}%)` : ''}
                            </span>
                            <span className="font-medium tabular-nums">
                              −{currency(pay.promo_discount)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between gap-3 border-t border-gray-100 pt-1">
                          <span className="font-semibold text-gray-800">
                            {Number(pay.promo_discount) > 0 ? 'Total after promo' : 'Total'}
                          </span>
                          <span className="font-bold text-ch-pine tabular-nums">{currency(total)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-gray-500">Paid</span>
                          <span className="font-medium tabular-nums text-emerald-700">{currency(paid)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-gray-500">Due</span>
                          <span className="font-semibold tabular-nums text-amber-800">{currency(due)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-3 min-w-[9rem]">
                      <div className="space-y-1.5">
                        <span
                          className={`inline-flex items-center rounded-md border px-2.5 py-1 text-sm font-bold tracking-wide ${paymentMethodTone(
                            b.payment_method
                          )}`}
                        >
                          {methodLabel}
                        </span>
                        <div>
                          <Badge status={b.payment_status || 'pending'} />
                        </div>
                        {needsDeposit(b) ? (
                          <div className="text-[11px] font-medium text-amber-800">Min 50% to accept</div>
                        ) : (
                          <div className="text-[11px] font-medium text-emerald-700">Already paid</div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-2 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-800 mb-1.5">
                          ID / passport {idPhotos.length > 0 ? `(${idPhotos.length})` : ''}
                        </div>
                        <div className="flex flex-wrap gap-2 min-w-[5.5rem]">
                          {idPhotos.length > 0 ? (
                            idPhotos.map((photo) => (
                              <button
                                key={photo}
                                type="button"
                                onClick={() => openPreview(idPhotos, photo)}
                                className="relative ring-2 ring-sky-300/70 rounded-md hover:ring-sky-500 transition"
                                title={isPdfUrl(photo) ? 'Review ID PDF' : 'Review guest photo'}
                              >
                                {isPdfUrl(photo) ? (
                                  idDocumentThumbUrl(photo) !== photo ? (
                                    <img
                                      src={idDocumentThumbUrl(photo)}
                                      alt="Guest ID PDF"
                                      className="h-14 w-14 rounded-md border border-sky-200 object-cover bg-white"
                                    />
                                  ) : (
                                    <span className="flex h-14 w-14 items-center justify-center rounded-md border border-sky-200 bg-white text-rose-700">
                                      <FileText className="h-6 w-6" />
                                    </span>
                                  )
                                ) : (
                                  <img
                                    src={photo}
                                    alt="Guest ID"
                                    className="h-14 w-14 rounded-md border border-sky-200 object-cover bg-white"
                                  />
                                )}
                                <span className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-sky-700 text-white shadow">
                                  <Maximize2 className="h-2.5 w-2.5" strokeWidth={2} aria-hidden="true" />
                                </span>
                              </button>
                            ))
                          ) : (
                            <span className="text-xs font-medium italic text-rose-600">No documents</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          disabled={acceptMutation.isPending}
                          onClick={() => openAcceptModal(b)}
                        >
                          <Check className="w-3.5 h-3.5" /> Accept
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs text-red-600"
                          disabled={rejectMutation.isPending}
                          onClick={() => openRejectModal(b)}
                        >
                          <X className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!acceptBooking}
        onClose={closeAcceptModal}
        title="Accept reservation"
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={closeAcceptModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={acceptMutation.isPending}
              onClick={submitAccept}
            >
              {acceptMutation.isPending ? 'Accepting…' : 'Confirm accept'}
            </button>
          </>
        }
      >
        {acceptBooking ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 space-y-2 sm:col-span-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Name</div>
                  <div className="text-base font-semibold text-gray-900">{acceptBooking.guest_name || '—'}</div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Phone</div>
                    <div className="text-sm font-semibold text-gray-800 tabular-nums">
                      {acceptBooking.guest_phone || (
                        <span className="font-normal italic text-rose-600">Missing phone</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Email</div>
                    <div className="text-sm font-medium text-gray-700 break-all">
                      {acceptBooking.guest_email || (
                        <span className="font-normal italic text-rose-600">Missing email</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Unit</div>
                <div className="font-medium text-gray-900">
                  {acceptBooking.unit_number || '—'}
                </div>
                <div className="text-xs text-gray-500">
                  {acceptBooking.unit_title || acceptBooking.listing_title || ''}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Guests</div>
                <div className="font-medium">{partyLabel(acceptBooking)}</div>
                <div className="text-xs text-gray-500">{partyCount(acceptBooking)} total</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Duration</div>
                <div className="font-medium">
                  {nightsBetween(acceptBooking.checkin, acceptBooking.checkout)} night
                  {nightsBetween(acceptBooking.checkin, acceptBooking.checkout) === 1 ? '' : 's'}
                </div>
                <div className="text-xs text-gray-500">
                  {formatDate(acceptBooking.checkin)} → {formatDate(acceptBooking.checkout)}
                </div>
              </div>
              <div className="sm:col-span-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 space-y-1.5 text-sm">
                <div className="text-xs uppercase text-gray-500 mb-1">Payment details</div>
                {(() => {
                  const pay = paymentBreakdown(acceptBooking);
                  const total = Number(pay.total_egp ?? acceptTotal) || 0;
                  const paid = Number(pay.amount_paid ?? acceptBooking.amount_paid) || 0;
                  const due = Number(pay.amount_due ?? Math.max(0, total - paid)) || 0;
                  return (
                    <>
                      {pay.subtotal != null && (
                        <div className="flex justify-between gap-3">
                          <span className="text-gray-500">Stay subtotal</span>
                          <span className="font-medium tabular-nums">{currency(pay.subtotal)}</span>
                        </div>
                      )}
                      {Number(pay.beach_access_fees) > 0 && (
                        <div className="flex justify-between gap-3">
                          <span className="text-gray-500">Beach access</span>
                          <span className="font-medium tabular-nums">{currency(pay.beach_access_fees)}</span>
                        </div>
                      )}
                      {Number(pay.service_fees) > 0 && (
                        <div className="flex justify-between gap-3">
                          <span className="text-gray-500">
                            Service fees{pay.service_fee_percent ? ` + taxes (${pay.service_fee_percent}%)` : ''}
                          </span>
                          <span className="font-medium tabular-nums">{currency(pay.service_fees)}</span>
                        </div>
                      )}
                      {Number(pay.amount_before_promo) > 0 && Number(pay.promo_discount) > 0 && (
                        <div className="flex justify-between gap-3">
                          <span className="text-gray-500">Before promo</span>
                          <span className="font-medium tabular-nums">{currency(pay.amount_before_promo)}</span>
                        </div>
                      )}
                      {Number(pay.promo_discount) > 0 && (
                        <div className="flex justify-between gap-3 text-emerald-700">
                          <span>
                            Promo
                            {pay.promo_code ? ` ${pay.promo_code}` : ''}
                            {pay.promo_discount_percent ? ` (−${pay.promo_discount_percent}%)` : ''}
                          </span>
                          <span className="font-medium tabular-nums">
                            −{currency(pay.promo_discount)}
                          </span>
                        </div>
                      )}
                      {Number(pay.security_deposit) > 0 && (
                        <div className="flex justify-between gap-3">
                          <span className="text-gray-500">Security deposit (held)</span>
                          <span className="font-medium tabular-nums">{currency(pay.security_deposit)}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-3 border-t border-gray-200 pt-1.5">
                        <span className="font-semibold text-gray-800">
                          {Number(pay.promo_discount) > 0 ? 'Total after promo' : 'Total'}
                        </span>
                        <span className="font-bold text-lg text-gray-900 tabular-nums">{currency(total)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-gray-500">Already paid</span>
                        <span className="font-medium text-emerald-700 tabular-nums">{currency(paid)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-gray-500">Remaining</span>
                        <span className="font-semibold text-amber-800 tabular-nums">{currency(due)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>
              <div>
                <div className="text-xs uppercase text-gray-500">Payment method</div>
                <span
                  className={`mt-1 inline-flex items-center rounded-md border px-2.5 py-1 text-sm font-bold ${paymentMethodTone(
                    acceptBooking.payment_method
                  )}`}
                >
                  {paymentMethodLabel(acceptBooking.payment_method)}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-sky-200 bg-sky-50/50 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-800 mb-2">
                Guest ID documents
              </div>
              <div className="flex flex-wrap gap-2">
                {toIdPhotos(acceptBooking).length ? (
                  toIdPhotos(acceptBooking).map((photo) => (
                    <button
                      key={photo}
                      type="button"
                      onClick={() => openPreview(toIdPhotos(acceptBooking), photo)}
                      className="relative ring-2 ring-sky-300/70 rounded-md"
                    >
                      {isPdfUrl(photo) ? (
                        idDocumentThumbUrl(photo) !== photo ? (
                          <img
                            src={idDocumentThumbUrl(photo)}
                            alt="Guest"
                            className="h-16 w-16 rounded-md border border-sky-200 object-cover"
                          />
                        ) : (
                          <span className="flex h-16 w-16 items-center justify-center rounded-md border border-sky-200 bg-white text-rose-700">
                            <FileText className="h-6 w-6" />
                          </span>
                        )
                      ) : (
                        <img
                          src={photo}
                          alt="Guest"
                          className="h-16 w-16 rounded-md border border-sky-200 object-cover"
                        />
                      )}
                    </button>
                  ))
                ) : (
                  <span className="text-sm font-medium italic text-rose-600">No documents uploaded</span>
                )}
              </div>
            </div>

            {needsDeposit(acceptBooking) ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-4">
                <p className="text-sm text-amber-900">
                  InstaPay / Cash: guest must pay at least 50% ({currency(halfAmount)}) before you can accept.
                </p>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Amount received
                  </label>
                  <select
                    className="input w-full"
                    value={paymentMode}
                    onChange={(e) => {
                      const mode = e.target.value;
                      setPaymentMode(mode);
                      if (mode === 'half') setCustomAmount(String(halfAmount));
                      if (mode === 'full') setCustomAmount(String(acceptTotal));
                    }}
                  >
                    <option value="half">50% deposit ({currency(halfAmount)})</option>
                    <option value="full">Full amount ({currency(acceptTotal)})</option>
                    <option value="other">Other amount</option>
                  </select>
                </div>

                {paymentMode === 'other' ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Enter amount paid (EGP)
                    </label>
                    <input
                      type="number"
                      min={halfAmount}
                      max={acceptTotal}
                      step="0.01"
                      className="input w-full"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                    />
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-white border px-3 py-2">
                    <div className="text-xs text-gray-500">Deducted now</div>
                    <div className="font-semibold">{currency(amountPaid)}</div>
                  </div>
                  <div className="rounded-lg bg-white border px-3 py-2">
                    <div className="text-xs text-gray-500">Remaining balance</div>
                    <div className="font-semibold text-amber-800">{currency(remaining)}</div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Payment evidence
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-3 text-sm hover:border-amber-400">
                    <Upload className="h-4 w-4 text-gray-500" />
                    <span className="truncate">
                      {evidenceFile ? evidenceFile.name : 'Upload transfer / cash receipt'}
                    </span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
                This booking is already paid online. No deposit entry needed.
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!rejectBooking}
        onClose={closeRejectModal}
        title="Reject booking"
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={closeRejectModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary bg-red-600 hover:bg-red-700 border-red-600"
              disabled={rejectMutation.isPending || !rejectReason.trim()}
              onClick={submitReject}
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Confirm reject'}
            </button>
          </>
        }
      >
        {rejectBooking ? (
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              Reject request for{' '}
              <span className="font-medium text-gray-900">{rejectBooking.guest_name}</span>
              {rejectBooking.unit_number ? (
                <>
                  {' '}
                  · unit <span className="font-medium text-gray-900">{rejectBooking.unit_number}</span>
                </>
              ) : null}
              .
            </div>
            <div>
              <label className="label">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                className="input resize-none"
                rows={4}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this booking is being rejected…"
                required
              />
              {!rejectReason.trim() ? (
                <p className="mt-1 text-xs text-red-500">A reason is required before rejecting.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      {previewPhotos.length > 0 && (
        <IdDocumentPreviewModal
          urls={previewPhotos}
          index={previewPhotoIndex}
          zClass="z-[210]"
          onClose={() => setPreviewPhotos([])}
          onIndexChange={setPreviewPhotoIndex}
        />
      )}
    </div>
  );
}
