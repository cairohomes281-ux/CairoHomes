import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { usePermissions } from '../hooks/usePermissions';
import { formatDateTime } from '../utils/formatters';

const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'signed', label: 'Signed' },
  { value: 'rejected', label: 'Rejected' },
];

function normalizeStatus(stage) {
  const s = String(stage || '').toLowerCase();
  if (s === 'signed' || s === 'contract_signed' || s === 'live') return 'signed';
  if (s === 'rejected') return 'rejected';
  return 'pending';
}

function statusBadgeClass(status) {
  if (status === 'signed') return 'bg-emerald-50 text-emerald-800';
  if (status === 'rejected') return 'bg-rose-50 text-rose-800';
  return 'bg-amber-50 text-amber-800';
}

export default function AcquisitionPipeline() {
  const qc = useQueryClient();
  const { isResale } = usePermissions();
  const [deleteId, setDeleteId] = useState(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['acquisition-leads'],
    queryFn: () => api.get('/acquisition-leads').then((r) => r.data),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/acquisition-leads/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['acquisition-leads'] });
      toast.success('Status updated');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not update status'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/acquisition-leads/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['acquisition-leads'] });
      toast.success('Request deleted');
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not delete request'),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6 p-1">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {isResale ? 'Owners requests' : 'Owner leads'}
        </h1>
        <p className="text-sm text-gray-500">
          Contact requests from Become a Host and intake. Mark as Pending, Signed, or Rejected.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Requested</th>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Phone</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Unit type</th>
              <th className="px-4 py-3 text-left">Destination</th>
              <th className="px-4 py-3 text-left">Project</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.map((lead) => {
              const status = normalizeStatus(lead.stage);
              return (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {lead.created_at ? formatDateTime(lead.created_at) : '—'}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{lead.owner_name || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {lead.owner_phone ? (
                      <a href={`tel:${lead.owner_phone}`} className="hover:text-primary-700">
                        {lead.owner_phone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {lead.owner_email ? (
                      <a
                        href={`mailto:${lead.owner_email}`}
                        className="break-all hover:text-primary-700"
                      >
                        {lead.owner_email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{lead.property_type || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lead.destination || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{lead.project || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}
                      >
                        {STATUSES.find((s) => s.value === status)?.label || 'Pending'}
                      </span>
                      <select
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
                        value={status}
                        disabled={statusMutation.isPending}
                        onChange={(e) =>
                          statusMutation.mutate({ id: lead.id, status: e.target.value })
                        }
                        aria-label={`Status for ${lead.owner_name || 'lead'}`}
                      >
                        {STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="inline-flex rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                      title="Delete request"
                      onClick={() => setDeleteId(lead.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.length && (
          <p className="p-6 text-center text-sm text-gray-400">No owner requests yet</p>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        title="Delete request"
        message="This permanently deletes the owner request. This cannot be undone."
        confirmText="Delete"
        danger
      />
    </div>
  );
}
