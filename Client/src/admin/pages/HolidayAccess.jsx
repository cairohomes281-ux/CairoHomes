import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import { ROLE_LABELS, canEditStaffCompensation } from '../utils/permissions';
import { formatDate } from '../utils/formatters';
import { usePermissions } from '../hooks/usePermissions';

const ACCESS_LABELS = {
  auto: 'Auto (6 months)',
  granted: 'Allowed',
  denied: 'Blocked',
};

export default function HolidayAccess() {
  const qc = useQueryClient();
  const { user } = usePermissions();
  const [search, setSearch] = useState('');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-holiday-access'],
    queryFn: () => api.get('/hr/holiday-access').then((r) => r.data),
  });

  const mutation = useMutation({
    mutationFn: ({ id, holiday_access }) => api.patch(`/hr/holiday-access/${id}`, { holiday_access }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-holiday-access'] });
      toast.success('Holiday access updated');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update access'),
  });

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (Array.isArray(rows) ? rows : []).filter((r) => {
        if (!q) return true;
        return [r.full_name, r.staff_code, ROLE_LABELS[r.role]]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [rows, q]
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ch-muted">HR</p>
        <h1 className="page-title mt-1">Holidays access</h1>
        <p className="page-subtitle">
          Choose who can request paid holidays. Auto allows casual and annual after 6 months.
          Casual and annual need manager then HR Manager.
          Unpaid leave and excuses also need manager then HR Manager (no holiday access required).
          HR or an HR Manager can change access for any staff.
        </p>
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search staff…" />

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No staff" />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Joined</th>
                  <th>Tenure</th>
                  <th>Setting</th>
                  <th>Paid holidays</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const canEditRow = canEditStaffCompensation(user, r.id);
                  return (
                  <tr key={r.id}>
                    <td>
                      <div className="font-semibold text-ch-pine">{r.full_name}</div>
                      <div className="text-[11px] text-ch-muted">
                        {r.staff_code ? `${r.staff_code} · ` : ''}
                        {ROLE_LABELS[r.role] || r.role}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{formatDate(r.created_at)}</td>
                    <td>{r.tenure_months} mo</td>
                    <td>
                      <select
                        className="input py-1 text-sm"
                        value={r.holiday_access || 'auto'}
                        disabled={mutation.isPending || !canEditRow}
                        title={
                          !canEditRow
                            ? 'Only HR, an HR Manager, or a CEO can change holiday access'
                            : undefined
                        }
                        onChange={(e) =>
                          mutation.mutate({ id: r.id, holiday_access: e.target.value })
                        }
                      >
                        {Object.entries(ACCESS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          r.can_request_holidays
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {r.can_request_holidays ? 'Yes' : 'No'}
                      </span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
