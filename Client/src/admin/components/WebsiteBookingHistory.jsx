import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Pencil } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from './ui/LoadingSpinner';
import Modal from './ui/Modal';
import { currency, formatDate, formatDateTime } from '../utils/formatters';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'pending', label: 'Pending' },
  { id: 'rejected', label: 'Rejected' },
];

function FilterChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-block flex-none rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
        active
          ? 'border-ch-pine bg-ch-pine-50 text-ch-pine'
          : 'border-ch-line bg-white text-ch-pine hover:border-ch-pine'
      }`}
    >
      {children}
    </button>
  );
}

function statusTone(decision) {
  if (decision === 'rejected') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (decision === 'pending') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

function isCardPrepaid(booking) {
  const method = String(booking?.payment_method || '').toLowerCase();
  return method.includes('paymob') || method.includes('card');
}

function canEditCollected(booking) {
  if (!booking || booking.decision === 'rejected') return false;
  if (String(booking.status || '').toLowerCase() !== 'confirmed') return false;
  if (isCardPrepaid(booking)) return false;
  return true;
}

export default function WebsiteBookingHistory() {
  const [filter, setFilter] = useState('all');
  const [editBooking, setEditBooking] = useState(null);
  const [amountMode, setAmountMode] = useState('full');
  const [customAmount, setCustomAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const qc = useQueryClient();

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['website-bookings-history'],
    queryFn: () =>
      api.get('/website-bookings', { params: { status: 'history' } }).then((r) => r.data),
    refetchInterval: 60000,
  });

  const filtered = useMemo(() => {
    if (filter === 'all') return history;
    return history.filter((b) => b.decision === filter);
  }, [history, filter]);

  const editTotal = Number(editBooking?.total_egp) || 0;
  const editCurrentPaid = Number(editBooking?.amount_paid) || 0;
  const halfAmount = Math.round(editTotal * 0.5 * 100) / 100;
  const amountPaid =
    amountMode === 'full'
      ? editTotal
      : amountMode === 'half'
        ? halfAmount
        : Math.round((parseFloat(customAmount) || 0) * 100) / 100;

  const openEdit = (booking) => {
    setEditBooking(booking);
    const paid = Number(booking.amount_paid) || 0;
    const total = Number(booking.total_egp) || 0;
    const half = Math.round(total * 0.5 * 100) / 100;
    if (paid + 0.5 >= total && total > 0) {
      setAmountMode('full');
      setCustomAmount(String(total));
    } else if (Math.abs(paid - half) <= 0.5 && half > 0) {
      setAmountMode('half');
      setCustomAmount(String(half));
    } else {
      setAmountMode('other');
      setCustomAmount(String(paid || half || ''));
    }
    setPaymentMethod('cash');
  };

  const closeEdit = () => {
    setEditBooking(null);
    setCustomAmount('');
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, amount_paid, payment_method }) =>
      api.post(`/website-bookings/${id}/collected-amount`, { amount_paid, payment_method }),
    onSuccess: () => {
      toast.success('Collected amount updated');
      qc.invalidateQueries({ queryKey: ['website-bookings-history'] });
      closeEdit();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const submitEdit = () => {
    if (!editBooking) return;
    if (!(amountPaid >= 0)) {
      toast.error('Enter a valid collected amount');
      return;
    }
    if (amountPaid > editTotal + 0.5) {
      toast.error('Collected amount cannot exceed the total');
      return;
    }
    updateMutation.mutate({
      id: editBooking.id,
      amount_paid: amountPaid,
      payment_method: paymentMethod,
    });
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="card p-4 space-y-4">
      <div>
        <h2 className="font-semibold text-gray-900">Booking history</h2>
        <p className="text-xs text-gray-500">
          Accepted = fully paid. Pending = accepted with remaining balance. Rejected = declined with
          reason. Requested is when the guest submitted; Decided is when the agent accepted, left
          pending, or rejected. Use Edit collected to update how much was received.
        </p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => (
          <FilterChip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </FilterChip>
        ))}
      </div>

      {!filtered.length ? (
        <p className="text-sm text-gray-500 py-8 text-center">
          {filter === 'all'
            ? 'No accepted, pending, or rejected bookings yet.'
            : `No ${filter} bookings.`}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-2 pr-3">Guest</th>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3">Stay</th>
                <th className="py-2 pr-3">Total</th>
                <th className="py-2 pr-3">Paid / Due</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 pr-3">Decided by</th>
                <th className="py-2 pr-3">Requested</th>
                <th className="py-2 pr-3">Decided</th>
                <th className="py-2">Money</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const decision = b.decision;
                const rejected = decision === 'rejected';
                const pending = decision === 'pending';
                const editable = canEditCollected(b);
                return (
                  <tr key={b.id} className="border-t border-gray-100 align-top">
                    <td className="py-3 pr-3 min-w-[10rem]">
                      <div className="font-medium text-gray-900">{b.guest_name || '—'}</div>
                      <div className="text-xs text-gray-500">
                        {b.guest_phone || b.guest_email || ''}
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <div className="font-medium">{b.unit_number || '—'}</div>
                      <div className="text-xs text-gray-500 truncate max-w-[10rem]">
                        {b.unit_title || b.listing_title || ''}
                      </div>
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-xs">
                      {formatDate(b.checkin)} → {formatDate(b.checkout)}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap tabular-nums font-medium">
                      {currency(b.total_egp)}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-xs">
                      {rejected ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <>
                          <div className="tabular-nums text-gray-800">
                            Paid {currency(b.amount_paid)}
                          </div>
                          {pending || Number(b.amount_due) > 0 ? (
                            <div className="tabular-nums text-amber-700 font-medium">
                              Due {currency(b.amount_due)}
                            </div>
                          ) : (
                            <div className="text-emerald-700">Settled</div>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold border ${statusTone(
                          decision
                        )}`}
                      >
                        {b.decision_label ||
                          (rejected ? 'Rejected' : pending ? 'Pending' : 'Accepted')}
                      </span>
                    </td>
                    <td className="py-3 pr-3 max-w-[16rem]">
                      {rejected ? (
                        <p className="text-sm text-rose-800 whitespace-pre-wrap">
                          {b.decision_reason || '—'}
                        </p>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-sm">
                      {b.decided_by_name || b.assigned_agent_name || '—'}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-xs text-gray-600">
                      {formatDateTime(b.requested_at || b.created_at)}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-xs text-gray-600">
                      <div>{b.decided_at ? formatDateTime(b.decided_at) : '—'}</div>
                      {b.decided_at ? (
                        <div className="text-[11px] text-gray-400 capitalize">
                          {rejected ? 'Rejected' : pending ? 'Accepted (pending)' : 'Accepted'}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3">
                      {editable ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs py-1.5 px-2.5"
                          onClick={() => openEdit(b)}
                        >
                          <Pencil className="w-3.5 h-3.5" /> Edit
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!editBooking}
        onClose={closeEdit}
        title="Edit collected amount"
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={closeEdit}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={updateMutation.isPending}
              onClick={submitEdit}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save collected'}
            </button>
          </>
        }
      >
        {editBooking ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm space-y-1">
              <div className="font-semibold text-gray-900">{editBooking.guest_name || '—'}</div>
              <div className="text-xs text-gray-500">
                {editBooking.unit_number || '—'} · {formatDate(editBooking.checkin)} →{' '}
                {formatDate(editBooking.checkout)}
              </div>
              <div className="flex justify-between gap-3 pt-1 border-t border-gray-200 mt-1.5">
                <span className="text-gray-500">Total</span>
                <span className="font-semibold tabular-nums">{currency(editTotal)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Currently paid</span>
                <span className="tabular-nums">{currency(editCurrentPaid)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Currently due</span>
                <span className="tabular-nums text-amber-700 font-medium">
                  {currency(Math.max(0, editTotal - editCurrentPaid))}
                </span>
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Set collected to
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'half', label: `50% (${currency(halfAmount)})` },
                  { id: 'full', label: `Full (${currency(editTotal)})` },
                  { id: 'other', label: 'Other' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setAmountMode(opt.id);
                      if (opt.id === 'half') setCustomAmount(String(halfAmount));
                      if (opt.id === 'full') setCustomAmount(String(editTotal));
                    }}
                    className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                      amountMode === opt.id
                        ? 'border-ch-pine bg-ch-pine-50 text-ch-pine'
                        : 'border-gray-200 bg-white text-gray-700 hover:border-ch-pine'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {amountMode === 'other' ? (
                <div className="mt-3">
                  <label className="label">Collected amount (EGP)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                  />
                </div>
              ) : null}
            </div>

            <div>
              <label className="label">Payment method (if adding more)</label>
              <select
                className="input"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="instapay">InstaPay</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm flex justify-between gap-3">
              <span className="text-emerald-800 font-medium">New collected</span>
              <span className="font-bold tabular-nums text-emerald-900">{currency(amountPaid)}</span>
            </div>
            <div className="text-xs text-gray-500 flex justify-between gap-3">
              <span>Remaining after save</span>
              <span className="tabular-nums font-medium text-amber-700">
                {currency(Math.max(0, editTotal - amountPaid))}
              </span>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
