import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import { ROLE_LABELS, canRequestLoan, canSeeRequestQueue } from '../utils/permissions';
import { currency, formatDate } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';
import { RequestReviewActions, approvalStatusClass } from '../components/RequestReviewActions';
import { acknowledgeRequest } from '../utils/requestAcknowledgements';

export default function Loans({ embedded = false }) {
  const { user } = useAuth();
  const canQueue = canSeeRequestQueue(user);
  const canRequest = canRequestLoan(user);
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [rejectRow, setRejectRow] = useState(null);
  const [note, setNote] = useState('');
  const [form, setForm] = useState({ amount: '', reason: '' });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-loans', user?.id, status],
    queryFn: () =>
      api
        .get('/hr/loans', {
          params: {
            ...(status === 'all' ? {} : { status }),
          },
        })
        .then((r) => r.data),
    enabled: !!user?.id,
  });

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/hr/loans', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-loans'] });
      toast.success('Loan request sent');
      setForm({ amount: '', reason: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not submit loan'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status: next, review_note }) =>
      api.post(`/hr/loans/${id}/review`, { status: next, review_note }),
    onSuccess: (_, vars) => {
      acknowledgeRequest('loan', vars.id, user?.id);
      qc.invalidateQueries({ queryKey: ['hr-loans'] });
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      toast.success(vars.status === 'approved' ? 'Acceptance recorded' : 'Loan rejected');
      setRejectRow(null);
      setNote('');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update request'),
  });

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (Array.isArray(rows) ? rows : []).filter((r) => {
        if (!q) return true;
        return [r.full_name, r.staff_code, r.reason]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [rows, q]
  );

  return (
    <div className="space-y-6">
      {!embedded ? (
      <div className="page-header">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ch-muted">HR</p>
        <h1 className="page-title mt-1">Loans</h1>
        <p className="page-subtitle">
          {canQueue
            ? 'Loans go HR Manager → Financial Manager. Everyone can see which step is waiting. The CEO can accept or reject any request.'
            : 'Request a loan. The HR Manager accepts first, then the Financial Manager. It is deducted from next month’s salary after both accept.'}
        </p>
      </div>
      ) : null}

      {canRequest ? (
      <div className="card space-y-3">
        <h3 className="font-semibold text-ch-pine">Request a loan</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Amount (EGP) *</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Reason *</label>
            <textarea
              className="input min-h-[72px]"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={createMutation.isPending}
          onClick={() => {
            if (!(Number(form.amount) > 0)) return toast.error('Enter an amount');
            if (!form.reason.trim()) return toast.error('Enter a reason');
            createMutation.mutate({ amount: Number(form.amount), reason: form.reason.trim() });
          }}
        >
          {createMutation.isPending ? 'Sending…' : 'Send request'}
        </button>
      </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchFilter value={search} onChange={setSearch} placeholder="Search loans…" />
        <select className="input sm:w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Banknote} title="No loan requests" />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Amount</th>
                  <th>Reason</th>
                  <th>Payroll month</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="font-semibold text-ch-pine">{r.full_name}</div>
                      <div className="text-[11px] text-ch-muted">
                        {r.staff_code ? `${r.staff_code} · ` : ''}
                        {ROLE_LABELS[r.role] || r.role}
                      </div>
                    </td>
                    <td className="tabular-nums font-semibold">{currency(r.amount)}</td>
                    <td className="max-w-[16rem]"><span className="line-clamp-2">{r.reason}</span></td>
                    <td className="whitespace-nowrap text-ch-muted">
                      {r.deduct_year && r.deduct_month
                        ? `${r.deduct_year}-${String(r.deduct_month).padStart(2, '0')}`
                        : '—'}
                    </td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${approvalStatusClass(r.status)}`}>
                        {r.approval_label || r.status}
                      </span>
                    </td>
                    <td>
                      <RequestReviewActions
                        row={r}
                        pending={reviewMutation.isPending}
                        onApprove={(row) => reviewMutation.mutate({ id: row.id, status: 'approved' })}
                        onReject={(row) => {
                          setRejectRow(row);
                          setNote('');
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={!!rejectRow}
        onClose={() => setRejectRow(null)}
        title="Reject loan"
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRejectRow(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={reviewMutation.isPending}
              onClick={() =>
                reviewMutation.mutate({
                  id: rejectRow.id,
                  status: 'rejected',
                  review_note: note.trim() || undefined,
                })
              }
            >
              Reject
            </button>
          </>
        }
      >
        <p className="text-sm text-ch-muted mb-3">
          Reject {rejectRow?.full_name}’s loan of {rejectRow ? currency(rejectRow.amount) : ''}?
        </p>
        <label className="label">Note (optional)</label>
        <textarea className="input min-h-[80px]" value={note} onChange={(e) => setNote(e.target.value)} />
      </Modal>
    </div>
  );
}
