import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import { ROLE_LABELS } from '../utils/permissions';
import { formatDate, formatDateTime, currency } from '../utils/formatters';
import { LEAVE_TYPE_LABELS } from '../utils/hrPolicy';
import { useAuth } from '../context/AuthContext';
import { approvalStatusClass, requestApprovalSummary } from '../components/RequestReviewActions';

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

const KIND_TABS = [
  { id: 'all', label: 'All types' },
  { id: 'holiday', label: 'Holiday' },
  { id: 'wfh', label: 'WFH' },
  { id: 'loans', label: 'Loans' },
];

function kindLabel(row) {
  if (row.history_kind === 'loan' || row.request_kind === 'loan') return 'Loan';
  if (row.history_kind === 'wfh' || row.request_kind === 'wfh') return 'WFH';
  return 'Holiday';
}

function detailLabel(row) {
  if (row.history_kind === 'loan' || row.amount != null) {
    return currency(row.amount);
  }
  if (row.history_kind === 'wfh' || row.work_date) {
    return formatDate(row.work_date);
  }
  const type = LEAVE_TYPE_LABELS[row.leave_type] || row.leave_type || 'Leave';
  const range =
    row.start_date && row.end_date && row.start_date !== row.end_date
      ? `${formatDate(row.start_date)} → ${formatDate(row.end_date)}`
      : formatDate(row.start_date || row.end_date);
  return `${type}${range ? ` · ${range}` : ''}`;
}

export default function RequestsHistory() {
  const { user } = useAuth();
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['hr-requests-history', user?.id, status, kind],
    queryFn: () =>
      api
        .get('/hr/requests-history', {
          params: {
            status: status === 'all' ? undefined : status,
            kind: kind === 'all' ? undefined : kind,
          },
        })
        .then((r) => r.data),
  });

  const rows = useMemo(() => {
    const items = Array.isArray(data?.items) ? data.items : [];
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((r) => {
      const hay = [
        r.full_name,
        r.staff_code,
        ROLE_LABELS[r.role] || r.role,
        kindLabel(r),
        r.leave_type,
        r.reason,
        r.approval_label,
        r.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [data, q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500">
            Company and team request history across holiday, WFH, and loans.
          </p>
        </div>
        <SearchFilter value={q} onChange={setQ} placeholder="Search name, type, status…" />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-xl border border-ch-line bg-white p-0.5">
          {KIND_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setKind(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                kind === tab.id ? 'bg-ch-pine text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-ch-line bg-white p-0.5">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatus(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                status === tab.id ? 'bg-ch-pine text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !rows.length ? (
        <EmptyState
          icon={History}
          title="No request history"
          subtitle="Nothing matches these filters yet."
        />
      ) : (
        <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Staff</th>
                  <th>Detail</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Approvals</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.history_kind}-${r.id}`}>
                    <td className="font-medium whitespace-nowrap">{kindLabel(r)}</td>
                    <td>
                      <div className="font-medium">{r.full_name || '—'}</div>
                      <div className="text-[11px] text-gray-400">
                        {ROLE_LABELS[r.role] || r.role}
                        {r.staff_code ? ` · ${r.staff_code}` : ''}
                      </div>
                    </td>
                    <td className="max-w-[16rem]">
                      <div className="truncate">{detailLabel(r)}</div>
                      {r.reason ? (
                        <div className="text-[11px] text-gray-400 truncate">{r.reason}</div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap text-gray-600">
                      {formatDateTime(r.created_at)}
                    </td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${approvalStatusClass(
                          r.status
                        )}`}
                      >
                        {r.approval_label || r.status}
                      </span>
                    </td>
                    <td className="text-xs text-gray-600 max-w-[14rem]">
                      {requestApprovalSummary(r)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
