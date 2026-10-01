import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Tag, Eye, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import WebsitePopupSection from '../components/WebsitePopupSection';
import { currency, formatDate, formatDateTime } from '../utils/formatters';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';

const EMPTY_FORM = {
  code: '',
  discount_type: 'percent',
  discount_percent: '',
  discount_amount: '',
  max_uses: '',
  expires_at: '',
  description: '',
  active: true,
  once_per_guest: true,
  scope_mode: 'all',
  scope_destinations: [],
  scope_projects: [],
  scope_unit_ids: [],
};

function hasScope(promo) {
  return Boolean(
    promo?.scope_destinations?.length || promo?.scope_projects?.length || promo?.scope_unit_ids?.length
  );
}

function toForm(promo) {
  if (!promo) return { ...EMPTY_FORM };
  const hasPercent = Number(promo.discount_percent) > 0;
  return {
    scope_mode: hasScope(promo) ? 'limited' : 'all',
    scope_destinations: promo.scope_destinations || [],
    scope_projects: promo.scope_projects || [],
    scope_unit_ids: promo.scope_unit_ids || [],
    code: promo.code || '',
    discount_type: hasPercent ? 'percent' : 'fixed',
    discount_percent: hasPercent ? String(promo.discount_percent) : '',
    discount_amount: !hasPercent && promo.discount_amount != null ? String(promo.discount_amount) : '',
    max_uses: promo.max_uses != null ? String(promo.max_uses) : '',
    expires_at: promo.expires_at ? String(promo.expires_at).slice(0, 10) : '',
    description: promo.description || '',
    active: promo.active !== false,
    once_per_guest: promo.once_per_guest !== false,
  };
}

function toPayload(form) {
  return {
    code: form.code,
    discount_percent: form.discount_type === 'percent' ? form.discount_percent : null,
    discount_amount: form.discount_type === 'fixed' ? form.discount_amount : null,
    max_uses: form.max_uses || null,
    expires_at: form.expires_at || null,
    description: form.description || null,
    active: form.active,
    once_per_guest: form.once_per_guest,
    scope_destinations: form.scope_mode === 'limited' ? form.scope_destinations : [],
    scope_projects: form.scope_mode === 'limited' ? form.scope_projects : [],
    scope_unit_ids: form.scope_mode === 'limited' ? form.scope_unit_ids : [],
  };
}

function unitLabel(u) {
  return [u.unit_number || u.internal_code, u.title].filter(Boolean).join(' · ') || 'Unit';
}

function scopeSummary(promo, unitsById) {
  if (!hasScope(promo)) return 'All homes';
  const parts = [
    ...(promo.scope_destinations || []),
    ...(promo.scope_projects || []),
    ...(promo.scope_unit_ids || []).map((id) => unitsById[id]?.unit_number || unitsById[id]?.title || 'Unit'),
  ];
  return parts.length > 3 ? `${parts.slice(0, 3).join(', ')} +${parts.length - 3}` : parts.join(', ');
}

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-ch-pine bg-ch-pine text-white'
          : 'border-ch-line bg-white text-gray-700 hover:border-ch-pine/50'
      }`}
    >
      {children}
    </button>
  );
}

function ScopePicker({ form, setForm, units }) {
  const { destinations, projectsByDestination } = useProjectCatalog();
  const [unitSearch, setUnitSearch] = useState('');

  const filteredUnits = useMemo(() => {
    const q = unitSearch.trim().toLowerCase();
    const list = q
      ? units.filter((u) =>
          [u.unit_number, u.internal_code, u.title, u.project, u.compound, u.area]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        )
      : units;
    return list.slice(0, 200);
  }, [units, unitSearch]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const selectedCount =
    form.scope_destinations.length + form.scope_projects.length + form.scope_unit_ids.length;

  return (
    <div className="space-y-3 rounded-xl border border-ch-line p-3">
      <div>
        <span className="block text-sm font-semibold text-gray-900">Where it applies</span>
        <span className="block text-xs text-gray-500">
          Limit the code to destinations, projects or specific homes. A home qualifies if it matches any selection.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip active={form.scope_mode === 'all'} onClick={() => set('scope_mode', 'all')}>
          All homes
        </Chip>
        <Chip active={form.scope_mode === 'limited'} onClick={() => set('scope_mode', 'limited')}>
          Only selected{form.scope_mode === 'limited' && selectedCount ? ` (${selectedCount})` : ''}
        </Chip>
      </div>

      {form.scope_mode === 'limited' && (
        <div className="space-y-4 pt-1">
          <div>
            <p className="label">Destinations</p>
            <div className="flex flex-wrap gap-2">
              {destinations.length === 0 && <span className="text-xs text-gray-400">No destinations yet.</span>}
              {destinations.map((d) => (
                <Chip
                  key={d}
                  active={form.scope_destinations.includes(d)}
                  onClick={() => set('scope_destinations', toggle(form.scope_destinations, d))}
                >
                  {d}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="label">Projects</p>
            <div className="space-y-2">
              {destinations.every((d) => !(projectsByDestination[d] || []).length) && (
                <span className="text-xs text-gray-400">No projects yet.</span>
              )}
              {destinations.map((d) =>
                (projectsByDestination[d] || []).length ? (
                  <div key={d}>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{d}</p>
                    <div className="flex flex-wrap gap-2">
                      {projectsByDestination[d].map((p) => (
                        <Chip
                          key={`${d}-${p}`}
                          active={form.scope_projects.includes(p)}
                          onClick={() => set('scope_projects', toggle(form.scope_projects, p))}
                        >
                          {p}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ) : null
              )}
            </div>
          </div>

          <div>
            <p className="label">Specific homes</p>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                value={unitSearch}
                onChange={(e) => setUnitSearch(e.target.value)}
                placeholder="Search by unit number, title or project"
              />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-xl border border-ch-line divide-y divide-ch-line">
              {filteredUnits.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-gray-400">No homes found.</p>
              )}
              {filteredUnits.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--pms-accent,#2f5d58)]"
                    checked={form.scope_unit_ids.includes(u.id)}
                    onChange={() => set('scope_unit_ids', toggle(form.scope_unit_ids, u.id))}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900">{unitLabel(u)}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {[u.project || u.compound, u.area].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function discountLabel(promo) {
  if (Number(promo.discount_percent) > 0) return `${Number(promo.discount_percent)}% off`;
  if (Number(promo.discount_amount) > 0) return `${currency(promo.discount_amount)} off`;
  return '—';
}

function PromoForm({ form, setForm, units }) {
  return (
    <div className="space-y-4">
      <div className="form-grid">
        <div>
          <label className="label">Code *</label>
          <input
            className="input uppercase tracking-wide"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder="CAIRO10"
          />
        </div>
        <div>
          <label className="label">Discount type *</label>
          <select
            className="input"
            value={form.discount_type}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                discount_type: e.target.value,
                discount_percent: e.target.value === 'percent' ? f.discount_percent : '',
                discount_amount: e.target.value === 'fixed' ? f.discount_amount : '',
              }))
            }
          >
            <option value="percent">Percent (%)</option>
            <option value="fixed">Fixed amount (EGP)</option>
          </select>
        </div>
        {form.discount_type === 'percent' ? (
          <div>
            <label className="label">Percent off *</label>
            <input
              type="number"
              min="1"
              max="100"
              step="0.01"
              className="input"
              value={form.discount_percent}
              onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))}
              placeholder="10"
            />
          </div>
        ) : (
          <div>
            <label className="label">Amount off (EGP) *</label>
            <input
              type="number"
              min="1"
              step="1"
              className="input"
              value={form.discount_amount}
              onChange={(e) => setForm((f) => ({ ...f, discount_amount: e.target.value }))}
              placeholder="500"
            />
          </div>
        )}
        <div>
          <label className="label">Global max uses</label>
          <input
            type="number"
            min="1"
            className="input"
            value={form.max_uses}
            onChange={(e) => setForm((f) => ({ ...f, max_uses: e.target.value }))}
            placeholder="Unlimited"
          />
          <p className="mt-1 text-[11px] text-gray-500">Leave empty for unlimited total redemptions.</p>
        </div>
        <div>
          <label className="label">Expires on</label>
          <input
            type="date"
            className="input"
            value={form.expires_at}
            onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description / notes</label>
          <textarea
            className="input min-h-[80px]"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Internal note, e.g. summer launch offer"
          />
        </div>
      </div>

      <ScopePicker form={form} setForm={setForm} units={units} />

      <label className="flex items-start gap-3 rounded-xl border border-ch-line bg-slate-50 px-3 py-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--pms-accent,#2f5d58)]"
          checked={form.once_per_guest}
          onChange={(e) => setForm((f) => ({ ...f, once_per_guest: e.target.checked }))}
        />
        <span>
          <span className="block text-sm font-semibold text-gray-900">Once per guest</span>
          <span className="block text-xs text-gray-500">
            Each guest (by email / account) can redeem this code only one time.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-xl border border-ch-line bg-slate-50 px-3 py-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--pms-accent,#2f5d58)]"
          checked={form.active}
          onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
        />
        <span>
          <span className="block text-sm font-semibold text-gray-900">Active</span>
          <span className="block text-xs text-gray-500">Inactive codes cannot be validated on checkout.</span>
        </span>
      </label>
    </div>
  );
}

export default function PromoCodes() {
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [viewId, setViewId] = useState(null);

  const { data: promos = [], isLoading } = useQuery({
    queryKey: ['promo-codes'],
    queryFn: () => api.get('/promo-codes').then((r) => r.data),
  });

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn: () => api.get('/units').then((r) => r.data),
  });
  const unitsById = useMemo(() => Object.fromEntries(units.map((u) => [u.id, u])), [units]);

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['promo-code', viewId],
    queryFn: () => api.get(`/promo-codes/${viewId}`).then((r) => r.data),
    enabled: !!viewId,
  });

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      editId ? api.put(`/promo-codes/${editId}`, payload) : api.post('/promo-codes', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promo-codes'] });
      toast.success(editId ? 'Promo updated' : 'Promo created');
      setModal(null);
      setEditId(null);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to save promo'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/promo-codes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promo-codes'] });
      toast.success('Promo deleted');
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to delete'),
  });

  const openCreate = () => {
    setEditId(null);
    setForm({ ...EMPTY_FORM });
    setModal('form');
  };

  const openEdit = (promo) => {
    setEditId(promo.id);
    setForm(toForm(promo));
    setModal('form');
  };

  const handleSave = () => {
    if (!String(form.code || '').trim()) {
      toast.error('Code is required');
      return;
    }
    if (form.discount_type === 'percent' && !(Number(form.discount_percent) > 0)) {
      toast.error('Enter a percent greater than 0');
      return;
    }
    if (form.discount_type === 'fixed' && !(Number(form.discount_amount) > 0)) {
      toast.error('Enter a fixed amount greater than 0');
      return;
    }
    if (
      form.scope_mode === 'limited' &&
      !form.scope_destinations.length &&
      !form.scope_projects.length &&
      !form.scope_unit_ids.length
    ) {
      toast.error('Pick at least one destination, project or home, or choose All homes');
      return;
    }
    saveMutation.mutate(toPayload(form));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="page-header mb-0">
          <h1 className="page-title">Promo codes</h1>
          <p className="page-subtitle">
            Discount codes for checkout, plus the single website entry popup.
          </p>
        </div>
        <button type="button" onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" /> New promo
        </button>
      </div>

      <WebsitePopupSection />

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Discount codes</h2>
        <p className="text-sm text-gray-500 mb-4">
          Create codes for website checkout. Each guest can use a code once when that rule is on.
        </p>
      {isLoading ? (
        <LoadingSpinner />
      ) : promos.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No promo codes yet"
          action={
            <button type="button" onClick={openCreate} className="btn-primary">
              <Plus className="h-4 w-4" /> Create first promo
            </button>
          }
        />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Discount</th>
                  <th>Applies to</th>
                  <th>Uses</th>
                  <th>Per guest</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {promos.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="font-semibold tracking-wide text-ch-pine">{p.code}</div>
                      {p.description ? (
                        <div className="text-xs text-gray-500 max-w-[16rem] truncate">{p.description}</div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap font-medium">{discountLabel(p)}</td>
                    <td className="max-w-[14rem] truncate text-gray-700" title={scopeSummary(p, unitsById)}>
                      {scopeSummary(p, unitsById)}
                    </td>
                    <td className="whitespace-nowrap tabular-nums">
                      {p.used_count || 0}
                      {p.max_uses != null ? ` / ${p.max_uses}` : ''}
                      {p.redemption_count != null && p.redemption_count !== p.used_count ? (
                        <span className="block text-[11px] text-gray-400">
                          {p.redemption_count} recorded
                        </span>
                      ) : null}
                    </td>
                    <td>{p.once_per_guest !== false ? 'Once' : 'Unlimited'}</td>
                    <td className="whitespace-nowrap">
                      {p.expires_at ? formatDate(p.expires_at) : '—'}
                    </td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          p.active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {p.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn-secondary text-xs px-2 py-1"
                          onClick={() => setViewId(p.id)}
                          title="View redemptions"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs px-2 py-1"
                          onClick={() => openEdit(p)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs px-2 py-1 text-rose-700"
                          onClick={() => setDeleteId(p.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
      <Modal
        open={modal === 'form'}
        onClose={() => {
          setModal(null);
          setEditId(null);
        }}
        title={editId ? 'Edit promo code' : 'New promo code'}
        size="lg"
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setModal(null);
                setEditId(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saveMutation.isPending}
              onClick={handleSave}
            >
              {saveMutation.isPending ? 'Saving…' : editId ? 'Save changes' : 'Create promo'}
            </button>
          </>
        }
      >
        <PromoForm form={form} setForm={setForm} units={units} />
      </Modal>

      <Modal
        open={!!viewId}
        onClose={() => setViewId(null)}
        title={detail?.code ? `Redemptions · ${detail.code}` : 'Redemptions'}
        size="lg"
        footer={
          <button type="button" className="btn-secondary" onClick={() => setViewId(null)}>
            Close
          </button>
        }
      >
        {detailLoading || !detail ? (
          <LoadingSpinner />
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-ch-line bg-slate-50 px-4 py-3 text-sm grid grid-cols-2 gap-2">
              <div>
                <span className="text-gray-500">Discount</span>
                <div className="font-semibold">{discountLabel(detail)}</div>
              </div>
              <div>
                <span className="text-gray-500">Uses</span>
                <div className="font-semibold tabular-nums">
                  {detail.used_count || 0}
                  {detail.max_uses != null ? ` / ${detail.max_uses}` : ''}
                </div>
              </div>
              <div className="col-span-2 text-xs text-gray-500">
                {detail.once_per_guest !== false
                  ? 'Each guest may redeem this code only once.'
                  : 'Guests may redeem this code more than once.'}
              </div>
            </div>
            {(detail.redemptions || []).length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center">No redemptions yet.</p>
            ) : (
              <div className="table-wrapper">
                <table className="table text-xs">
                  <thead>
                    <tr>
                      <th>Guest</th>
                      <th>Discount</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.redemptions.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div className="font-medium">{r.guest_email || r.guest_phone || r.guest_key}</div>
                          {r.booking_id ? (
                            <div className="text-[10px] text-gray-400">Booking {String(r.booking_id).slice(0, 8)}…</div>
                          ) : null}
                        </td>
                        <td className="tabular-nums">{currency(r.discount_amount)}</td>
                        <td className="whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMutation.mutate(deleteId)}
        title="Delete promo code?"
        message="This permanently removes the code and its redemption history."
        confirmText="Delete"
        danger
      />
    </div>
  );
}
