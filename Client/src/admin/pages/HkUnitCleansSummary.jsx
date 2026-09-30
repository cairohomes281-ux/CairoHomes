import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../utils/formatters';

export function UnitCleansSummarySection({ embedded = false }) {
  const { user } = useAuth();
  const isAgent = user?.role === 'operations';
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['hk-unit-cleans-summary', search],
    queryFn: async () => {
      const r = await api.get('/housekeeping/unit-cleans-summary', {
        params: search ? { q: search } : {},
      });
      return r.data || { items: [] };
    },
  });

  const rows = Array.isArray(data?.items) ? data.items : [];
  const cleanedCount = useMemo(
    () => rows.filter((r) => Number(r.times_cleaned) > 0).length,
    [rows]
  );

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {!embedded ? (
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Unit cleans</h1>
            <p className="mt-1 text-sm text-gray-500">
              {isAgent
                ? 'Units you have cleaned — last cleaned time, how many times, and assignment.'
                : 'Per unit: last cleaned, times cleaned, and who was assigned on the last clean.'}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            Refresh
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-end">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            Refresh
          </button>
        </div>
      )}

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label className="text-[10px] uppercase text-gray-500">Search unit / project</label>
          <input
            type="search"
            className="input text-sm py-1.5 mt-1"
            placeholder="Unit number or project"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSearch(q.trim());
            }}
          />
        </div>
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => setSearch(q.trim())}
        >
          Search
        </button>
        {search ? (
          <button
            type="button"
            className="text-sm text-gray-500 hover:text-gray-800 pb-2"
            onClick={() => {
              setQ('');
              setSearch('');
            }}
          >
            Clear
          </button>
        ) : null}
        <div className="text-xs text-gray-500 pb-2">
          {rows.length} unit{rows.length === 1 ? '' : 's'}
          {cleanedCount ? ` · ${cleanedCount} cleaned at least once` : ''}
        </div>
      </div>

      {isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load unit cleans:{' '}
          {error?.response?.data?.error || error?.message || 'Request failed'}
        </div>
      ) : !rows.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">
          <Building2 className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          No rental units match{search ? ' this search' : ''}.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
              <tr>
                <th className="py-3 px-4">Unit</th>
                <th className="py-3 px-4">Last cleaned</th>
                <th className="py-3 px-4">Times cleaned</th>
                <th className="py-3 px-4">Assigned to (last clean)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.unit_id} className="border-t align-top">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-ch-pine">{r.unit_number || r.unit_title || '—'}</div>
                    <div className="text-xs text-gray-500 truncate max-w-[12rem]">
                      {r.project || ''}
                    </div>
                    {r.ops_status ? (
                      <div className="text-[11px] text-gray-400 mt-0.5 capitalize">{r.ops_status}</div>
                    ) : null}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {r.last_cleaned_at ? (
                      formatDateTime(r.last_cleaned_at)
                    ) : (
                      <span className="text-gray-400">Never</span>
                    )}
                  </td>
                  <td className="py-3 px-4 tabular-nums font-medium">{r.times_cleaned ?? 0}</td>
                  <td className="py-3 px-4">
                    {r.assignee_name ? (
                      <>
                        <div className="font-medium">{r.assignee_name}</div>
                        {r.assignee_code ? (
                          <div className="text-[11px] text-gray-500 font-mono">{r.assignee_code}</div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
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

export default function HkUnitCleansSummary() {
  return <UnitCleansSummarySection />;
}
