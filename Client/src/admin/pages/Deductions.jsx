import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MinusCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { usePermissions } from '../hooks/usePermissions';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import SearchableSelect from '../components/ui/SearchableSelect';
import { ROLE_LABELS } from '../utils/permissions';
import { currency, formatDate } from '../utils/formatters';
import { dailyRate, DEDUCTION_TYPE_LABELS } from '../utils/hrPolicy';

const EMPTY = {
  staff_user_id: '',
  category: 'other',
  amount: '',
  reason: '',
  deduction_date: '',
  kind: 'deduction',
};

const MANUAL_CATEGORIES = ['other', 'penalty', 'performance', 'advance'];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Deductions() {
  const qc = useQueryClient();
  const { isAdmin, isHr } = usePermissions();
  const canEditDeductions = isAdmin || isHr;
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY, deduction_date: todayIso() });
  const [editingId, setEditingId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const categoryEditable = !editingId || MANUAL_CATEGORIES.includes(form.category);

  const openCreate = (kind = 'deduction') => {
    setEditingId(null);
    setForm({ ...EMPTY, kind, deduction_date: todayIso() });
    setModal(true);
  };

  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({
      staff_user_id: String(r.staff_user_id),
      category: r.category || 'other',
      amount: String(r.amount ?? ''),
      reason: r.reason || '',
      deduction_date: String(r.deduction_date || '').slice(0, 10),
      kind: 'deduction',
    });
    setModal(true);
  };

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });
  const staffOptions = (Array.isArray(users) ? users : []).filter(
    (u) => u.role !== 'owner' && u.role !== 'admin'
  );
  const selectedStaff = staffOptions.find((u) => String(u.id) === String(form.staff_user_id));
  const rate = selectedStaff ? dailyRate(selectedStaff.base_salary) : 0;

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-deductions'],
    queryFn: () => api.get('/hr/salary-deductions').then((r) => r.data),
  });
  const { data: bonusRows = [] } = useQuery({
    queryKey: ['hr-bonuses'],
    queryFn: () => api.get('/hr/salary-bonuses').then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, ...payload }) => {
      if (id) return api.put(`/hr/salary-deductions/${id}`, payload);
      return payload.kind === 'bonus'
        ? api.post('/hr/salary-bonuses', payload)
        : api.post('/hr/salary-deductions', payload);
    },
    onSuccess: (_, payload) => {
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-bonuses'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      qc.invalidateQueries({ queryKey: ['hr-payslip'] });
      toast.success(
        payload.id ? 'Deduction updated' : payload.kind === 'bonus' ? 'Bonus added' : 'Deduction applied'
      );
      setModal(false);
      setEditingId(null);
      setForm({ ...EMPTY, deduction_date: todayIso() });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save deduction'),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, kind }) =>
      kind === 'bonus' ? api.delete(`/hr/salary-bonuses/${id}`) : api.delete(`/hr/salary-deductions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-bonuses'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      qc.invalidateQueries({ queryKey: ['hr-payslip'] });
      toast.success('Deduction removed');
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not delete'),
  });

  const combined = useMemo(() => {
    const deductions = (Array.isArray(rows) ? rows : []).map((r) => ({
      ...r,
      kind: 'deduction',
      date: r.deduction_date,
    }));
    const bonuses = (Array.isArray(bonusRows) ? bonusRows : []).map((r) => ({
      ...r,
      kind: 'bonus',
      category: 'bonus',
      date: r.bonus_date,
    }));
    return [...deductions, ...bonuses].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }, [rows, bonusRows]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      combined.filter((r) => {
        if (!q) return true;
        return [r.full_name, r.staff_code, r.reason, r.category]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [combined, q]
  );

  const handleSave = () => {
    if (!form.staff_user_id) return toast.error('Choose a staff member');
    if (!form.deduction_date) return toast.error('Choose a date');
    if (!(Number(form.amount) > 0)) return toast.error('Enter an amount greater than 0');
    if (!String(form.reason || '').trim()) return toast.error('Enter a reason');
    saveMutation.mutate({
      id: editingId || undefined,
      staff_user_id: Number(form.staff_user_id),
      deduction_date: form.deduction_date,
      bonus_date: form.deduction_date,
      category: form.kind === 'bonus' || !categoryEditable ? undefined : form.category,
      amount: Number(form.amount),
      reason: form.reason.trim(),
      kind: form.kind,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ch-muted">HR</p>
          <h1 className="page-title mt-1">Deductions</h1>
          <p className="page-subtitle">
            Apply manual deductions and bonuses to staff payroll.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => openCreate()}>
            <Plus className="h-4 w-4" />
            Other deduction
          </button>
          <button type="button" className="btn-secondary" onClick={() => openCreate('bonus')}>
            <Plus className="h-4 w-4" />
            Add bonus
          </button>
        </div>
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search deductions…" />

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={MinusCircle}
          title="No deductions yet"
          action={
            <button type="button" className="btn-primary" onClick={() => openCreate()}>
              Add deduction
            </button>
          }
        />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Staff</th>
                  <th>Type</th>
                  <th>Reason</th>
                  <th>Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                    <td>
                      <div className="font-semibold text-ch-pine">{r.full_name}</div>
                      <div className="text-[11px] text-ch-muted">
                        {r.staff_code ? `${r.staff_code} · ` : ''}
                        {ROLE_LABELS[r.role] || r.role}
                      </div>
                    </td>
                    <td>{r.kind === 'bonus' ? 'Bonus' : DEDUCTION_TYPE_LABELS[r.category] || r.category}</td>
                    <td className="max-w-[18rem]">
                      <span className="line-clamp-2">{r.reason}</span>
                      {r.arrival_time ? (
                        <span className="block text-[11px] text-ch-muted">
                          Arrived {String(r.arrival_time).slice(0, 5)}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={`tabular-nums whitespace-nowrap font-semibold ${
                        r.kind === 'bonus' ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {r.kind === 'bonus' ? '+' : '−'}
                      {currency(r.amount)}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        {r.kind === 'deduction' && canEditDeductions ? (
                          <button
                            type="button"
                            className="btn-secondary text-xs px-2 py-1"
                            title="Edit deduction"
                            aria-label="Edit deduction"
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-secondary text-xs px-2 py-1 text-rose-700"
                          title="Delete"
                          aria-label="Delete"
                          onClick={() => setDeleteId({ id: r.id, kind: r.kind })}
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

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editingId ? 'Edit deduction' : form.kind === 'bonus' ? 'Add bonus' : 'Other deduction'}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setModal(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={saveMutation.isPending} onClick={handleSave}>
              {saveMutation.isPending ? 'Saving…' : editingId ? 'Save' : 'Apply'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Staff *</label>
            <SearchableSelect
              value={String(form.staff_user_id)}
              onChange={(v) => setForm((f) => ({ ...f, staff_user_id: v }))}
              placeholder="Select staff…"
              disabled={!!editingId}
              options={staffOptions.map((u) => ({
                value: String(u.id),
                label: `${u.full_name}${u.staff_code ? ` · ${u.staff_code}` : ''}`,
              }))}
            />
            {selectedStaff ? (
              <p className="mt-1 text-[11px] text-ch-muted">
                Salary {currency(selectedStaff.base_salary)} · daily rate {currency(rate)} (÷ 30)
              </p>
            ) : null}
          </div>
          <div className="form-grid">
            {form.kind !== 'bonus' ? (
            <div>
              <label className="label">Type *</label>
              {categoryEditable ? (
                <select
                  className="input"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                >
                  <option value="other">Other</option>
                  <option value="penalty">Penalty</option>
                  <option value="performance">Performance</option>
                  <option value="advance">Advance</option>
                </select>
              ) : (
                <input
                  className="input bg-gray-50"
                  value={DEDUCTION_TYPE_LABELS[form.category] || form.category}
                  readOnly
                />
              )}
            </div>
            ) : null}
            <div>
              <label className="label">Date *</label>
              <input
                type="date"
                className="input"
                value={form.deduction_date}
                onChange={(e) => setForm((f) => ({ ...f, deduction_date: e.target.value }))}
              />
            </div>
          </div>
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
          <div>
            <label className="label">Reason *</label>
            <textarea
              className="input min-h-[72px]"
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
          {editingId && ['lateness', 'absence'].includes(form.category) ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              This deduction comes from attendance. If attendance for this day is recalculated, it
              will be regenerated and this edit will be replaced.
            </p>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Remove deduction"
        danger
        confirmText="Delete"
        loading={deleteMutation.isPending}
        message={
          deleteId?.kind === 'bonus'
            ? 'This bonus will no longer count on the payslip for that date.'
            : 'This deduction will no longer count against payroll for that date.'
        }
        onConfirm={() => deleteMutation.mutate(deleteId)}
      />
    </div>
  );
}
