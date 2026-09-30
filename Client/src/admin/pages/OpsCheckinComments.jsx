import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { formatDate, formatDateTime } from '../utils/formatters';

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export function CheckinCommentsSection({ embedded = false }) {
  const qc = useQueryClient();
  const defaults = useMemo(() => defaultRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [status, setStatus] = useState('pending');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['ops-checkin-comments', from, to, status],
    queryFn: async () => {
      const r = await api.get('/ops/checkin-comments', { params: { from, to, status } });
      return r.data || { items: [] };
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, reviewed }) =>
      api.post(`/ops/checkin-comments/${id}/reviewed`, { reviewed }),
    onSuccess: (_d, vars) => {
      toast.success(vars.reviewed ? 'Marked reviewed' : 'Marked pending');
      qc.invalidateQueries({ queryKey: ['ops-checkin-comments'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update review'),
  });

  const rows = Array.isArray(data?.items) ? data.items : [];
  const pendingCount = rows.filter((r) => !r.reviewed).length;

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {!embedded ? (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Check-in comments</h1>
            <p className="mt-1 text-sm text-gray-500">
              Review comments left by operations agents before handing units to guests.
            </p>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={() => refetch()} disabled={isFetching}>
            Refresh
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-end">
          <button type="button" className="btn-secondary text-sm" onClick={() => refetch()} disabled={isFetching}>
            Refresh
          </button>
        </div>
      )}

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] uppercase text-gray-500">From</label>
          <input type="date" className="input text-sm py-1.5 mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] uppercase text-gray-500">To</label>
          <input type="date" className="input text-sm py-1.5 mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className="text-[10px] uppercase text-gray-500">Status</label>
          <select className="input text-sm py-1.5 mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pending review</option>
            <option value="reviewed">Reviewed</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="text-xs text-gray-500 pb-2">
          {rows.length} comment{rows.length === 1 ? '' : 's'}
          {status === 'all' ? ` · ${pendingCount} pending` : ''}
        </div>
      </div>

      {isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load comments: {error?.response?.data?.error || error?.message || 'Request failed'}
        </div>
      ) : !rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          No check-in comments in this range.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.id}
              className={`card p-4 border ${
                r.reviewed ? 'border-emerald-200 bg-emerald-50/30' : 'border-amber-200 bg-amber-50/20'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-gray-900">
                    {r.guest_name || '—'} · {r.unit_number || '—'}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Check-in {formatDate(r.check_in)}
                    {r.project ? ` · ${r.project}` : ''}
                    {r.ops_handed_over ? ' · Handed over' : ' · Not handed over yet'}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Agent: {r.comment_by_name || r.ops_assignee_name || '—'}
                    {r.comment_at ? ` · ${formatDateTime(r.comment_at)}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {r.reviewed ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 text-[11px] font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Reviewed
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 text-[11px] font-semibold">
                      Pending
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    disabled={reviewMutation.isPending}
                    onClick={() => reviewMutation.mutate({ id: r.id, reviewed: !r.reviewed })}
                  >
                    {r.reviewed ? 'Mark pending' : 'Mark reviewed'}
                  </button>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-ch-line bg-white px-3 py-2.5 text-sm text-gray-800 whitespace-pre-wrap">
                {r.comment}
              </div>
              {r.reviewed && r.reviewed_by_name ? (
                <div className="mt-2 text-[11px] text-emerald-800">
                  Reviewed by {r.reviewed_by_name}
                  {r.reviewed_at ? ` · ${formatDateTime(r.reviewed_at)}` : ''}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpsCheckinComments() {
  return <CheckinCommentsSection />;
}
