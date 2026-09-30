import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Sparkles } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { useAuth } from '../context/AuthContext';
import { currency, formatDate, formatDateTime } from '../utils/formatters';

function defaultRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export function CheckinsHistorySection({ embedded = false }) {
  const { user } = useAuth();
  const isAgent = user?.role === 'operations';
  const defaults = useMemo(() => defaultRange(), []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['ops-checkins-history', from, to],
    queryFn: async () => {
      const r = await api.get('/ops/checkins-history', { params: { from, to } });
      return r.data || { items: [] };
    },
  });

  const rows = Array.isArray(data?.items) ? data.items : [];

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {!embedded ? (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Check-ins history</h1>
            <p className="mt-1 text-sm text-gray-500">
              {isAgent
                ? 'Past arrivals assigned to you — collect and handover record.'
                : 'Past check-ins with money collected, handover, or agent assignment.'}
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
        <div className="text-xs text-gray-500 pb-2">{rows.length} record{rows.length === 1 ? '' : 's'}</div>
      </div>

      {isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load history: {error?.response?.data?.error || error?.message || 'Request failed'}
        </div>
      ) : !rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">No check-in history in this date range.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
              <tr>
                <th className="py-3 px-4">Check-in</th>
                <th className="py-3 px-4">Guest</th>
                <th className="py-3 px-4">Unit</th>
                <th className="py-3 px-4">Agent</th>
                <th className="py-3 px-4">Housekeeping</th>
                <th className="py-3 px-4">Money</th>
                <th className="py-3 px-4">Handover</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="font-medium">{formatDate(r.check_in)}</div>
                    <div className="text-[11px] text-gray-500">→ {formatDate(r.check_out)}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-gray-900">{r.guest_name || '—'}</div>
                    <div className="text-xs text-gray-500">{r.guest_phone || ''}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold">{r.unit_number || '—'}</div>
                    <div className="text-xs text-gray-500 truncate max-w-[10rem]">{r.project || ''}</div>
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-700">{r.ops_assignee_name || '—'}</td>
                  <td className="py-3 px-4">
                    {r.hk_cleaned ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold">
                        <Sparkles className="w-3.5 h-3.5" /> Cleaned
                      </span>
                    ) : (
                      <span className="text-xs text-amber-700">Not cleaned</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {r.ops_money_collected ? (
                      <div className="text-emerald-700 font-semibold inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Collected
                        {r.ops_money_collected_amount > 0 ? ` · ${currency(r.ops_money_collected_amount)}` : ''}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                    {r.ops_money_collected_at ? (
                      <div className="text-[11px] text-gray-500 mt-0.5">{formatDateTime(r.ops_money_collected_at)}</div>
                    ) : null}
                    {r.ops_money_collected_by_name ? (
                      <div className="text-[11px] text-gray-500">by {r.ops_money_collected_by_name}</div>
                    ) : null}
                  </td>
                  <td className="py-3 px-4 text-xs">
                    {r.ops_handed_over ? (
                      <div className="text-emerald-700 font-semibold">Handed over</div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                    {r.ops_handed_over_at ? (
                      <div className="text-[11px] text-gray-500 mt-0.5">{formatDateTime(r.ops_handed_over_at)}</div>
                    ) : null}
                    {r.ops_handed_over_by_name ? (
                      <div className="text-[11px] text-gray-500">by {r.ops_handed_over_by_name}</div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function OpsCheckinsHistory() {
  return <CheckinsHistorySection />;
}
