import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import SearchableSelect from '../components/ui/SearchableSelect';
import { currency, unitSelectLabel } from '../utils/formatters';

const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function OwnerDateBlocks() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = localISO(new Date());
  const [unitId, setUnitId] = useState('');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [preview, setPreview] = useState(null);
  const isStaffHelper = user?.role === 'owners_relations' || user?.role === 'admin';

  const { data: units = [], isLoading } = useQuery({
    queryKey: ['owner-units', user?.role],
    queryFn: () => api.get('/owner/units').then((r) => r.data),
  });

  const { data: blocks = [] } = useQuery({
    queryKey: ['owner-blocks', unitId, from],
    queryFn: () =>
      api
        .get('/owner/blocks', {
          params: {
            unit_id: unitId,
            from,
            to: localISO(new Date(Date.now() + 120 * 86400000)),
          },
        })
        .then((r) => r.data),
    enabled: !!unitId,
  });

  const previewMut = useMutation({
    mutationFn: () =>
      api.post('/owner/blocks/preview', { unit_id: unitId, from_date: from, to_date: to }).then((r) => r.data),
    onSuccess: (data) => setPreview(data),
    onError: (e) => toast.error(e.response?.data?.error || 'Preview failed'),
  });

  const blockMut = useMutation({
    mutationFn: () =>
      api.post('/owner/blocks', { unit_id: unitId, from_date: from, to_date: to }).then((r) => r.data),
    onSuccess: () => {
      toast.success(isStaffHelper ? 'Owner nights blocked' : 'Dates blocked for personal use');
      setPreview(null);
      qc.invalidateQueries({ queryKey: ['owner-blocks'] });
    },
    onError: (e) => {
      const impact = e.response?.data?.impact;
      if (impact) setPreview(impact);
      toast.error(e.response?.data?.error || 'Block failed');
    },
  });

  const clearMut = useMutation({
    mutationFn: () =>
      api
        .delete('/owner/blocks', { data: { unit_id: unitId, from_date: from, to_date: to } })
        .then((r) => r.data),
    onSuccess: () => {
      toast.success('Owner blocks cleared for range');
      qc.invalidateQueries({ queryKey: ['owner-blocks'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Clear failed'),
  });

  const unitOptions = useMemo(
    () =>
      units.map((u) => ({
        value: String(u.id),
        label: unitSelectLabel(u),
      })),
    [units]
  );

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {isStaffHelper ? 'Block owner nights' : 'Block personal-use dates'}
        </h1>
        <p className="text-sm text-gray-500">
          {isStaffHelper
            ? 'Block rental nights for an owner’s personal use. Preview revenue impact first; guest conflicts are rejected.'
            : 'Preview estimated revenue impact before blocking. Conflicts with guest bookings are rejected.'}
        </p>
      </div>

      <div className="bg-white border rounded-xl p-5 space-y-4">
        <div>
          <label className="text-xs text-gray-500 font-medium">Unit</label>
          <SearchableSelect
            value={unitId}
            onChange={(v) => {
              setUnitId(v);
              setPreview(null);
            }}
            options={[{ value: '', label: 'Select unit…' }, ...unitOptions]}
            placeholder="Select unit…"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 font-medium">From</label>
            <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium">To (exclusive / checkout)</label>
            <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={!unitId || previewMut.isPending}
            onClick={() => previewMut.mutate()}
          >
            Preview impact
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!unitId || blockMut.isPending}
            onClick={() => blockMut.mutate()}
          >
            Confirm block
          </button>
          <button
            type="button"
            className="btn-secondary text-red-600"
            disabled={!unitId || clearMut.isPending}
            onClick={() => clearMut.mutate()}
          >
            Clear range
          </button>
        </div>
      </div>

      {preview && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-2">
          <h3 className="font-semibold text-amber-900">Financial impact preview</h3>
          <p className="text-sm text-amber-800">
            {preview.nights} night(s) · basis: {preview.price_basis}
          </p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-amber-700">Est. gross forgone</p>
              <p className="font-semibold">{currency(preview.estimated_gross)}</p>
            </div>
            <div>
              <p className="text-xs text-amber-700">Est. commission</p>
              <p className="font-semibold">{currency(preview.estimated_commission)}</p>
            </div>
            <div>
              <p className="text-xs text-amber-700">Est. owner net forgone</p>
              <p className="font-semibold text-red-700">{currency(preview.estimated_owner_net_forgone)}</p>
            </div>
          </div>
          {preview.has_conflicts && (
            <p className="text-sm text-red-700 font-medium">
              {preview.conflicts.length} conflicting booking(s) — blocking not allowed until resolved.
            </p>
          )}
        </div>
      )}

      {unitId && (
        <div className="bg-white border rounded-xl p-5">
          <h3 className="font-semibold text-gray-900 mb-3">Upcoming owner/manual blocks</h3>
          {!blocks.length ? (
            <p className="text-sm text-gray-400">No blocks in the next ~4 months</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {blocks.map((b) => (
                <span
                  key={`${b.date}-${b.source}`}
                  className={`text-xs px-2 py-1 rounded-full ${
                    b.source === 'owner' ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {b.date} · {b.source}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
