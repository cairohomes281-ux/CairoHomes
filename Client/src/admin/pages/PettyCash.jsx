import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, ArrowRightCircle, Wallet, CreditCard, TrendingUp, TrendingDown, Pencil, Check, X, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useSortableTable } from '../hooks/useSortableTable';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SortTh from '../components/ui/SortTh';
import { currency, formatDate, unitDisplay, unitSelectLabel } from '../utils/formatters';
import { usePermissions } from '../hooks/usePermissions';
import SearchableSelect from '../components/ui/SearchableSelect';

const IN_CATEGORIES = [
  'Beach Access In',
  'Rental Fees',
  'Housekeeping',
  'Insurance',
  'Maintenance',
  'Others',
];

const OUT_CATEGORIES = [
  'Beach Access Out',
  'Housekeeping',
  'Insurance',
  'Maintenance',
  'Others',
];

const IN_REQUIRES_DATES  = ['Beach Access In', 'Rental Fees', 'Housekeeping'];
const OUT_REQUIRES_DATES = ['Beach Access Out', 'Housekeeping'];

const EMPTY_FORM = {
  type: 'out',
  unit_id: '', category: '', custom_description: '',
  amount: '', paid_by: 'company', owner_id: '',
  expense_date: '',
  res_from_date: '', res_to_date: '', notes: '',
  is_general: false,
  is_advance: false,
};

function PaidByBadge({ paidBy }) {
  if (paidBy === 'owner')  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Owner</span>;
  if (paidBy === 'tenant') return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">Tenant</span>;
  if (!paidBy)             return null;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Company</span>;
}

function EntryForm({ form, setForm, units, owners = [], ownerUnits = [], transferProof, onTransferProofChange }) {
  const isIn = form.type === 'in';
  const categories = isIn ? IN_CATEGORIES : OUT_CATEGORIES;
  const requiresDates = isIn ? IN_REQUIRES_DATES : OUT_REQUIRES_DATES;
  const needsDates = requiresDates.includes(form.category);
  const costOnOwner = !isIn && form.paid_by === 'owner';
  const unitOptions = costOnOwner ? ownerUnits : units;

  return (
    <div className="space-y-4">

      
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setForm(f => ({ ...EMPTY_FORM, type: 'out', expense_date: f.expense_date }))}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
            !isIn
              ? 'border-red-400 bg-red-50 text-red-700'
              : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
          }`}
        >
          <TrendingDown className="w-4 h-4" />Cash Out
        </button>
        <button
          type="button"
          onClick={() => setForm(f => ({ ...EMPTY_FORM, type: 'in', expense_date: f.expense_date }))}
          className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-semibold transition-all ${
            isIn
              ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
              : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
          }`}
        >
          <TrendingUp className="w-4 h-4" />Cash In
        </button>
      </div>

      
      {isIn && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, is_advance: false }))}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-semibold transition-all ${
              !form.is_advance
                ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
            }`}
          >
            Income / إيراد
          </button>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, is_advance: true }))}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-semibold transition-all ${
              form.is_advance
                ? 'border-blue-400 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
            }`}
          >
            عهدة / Advance
          </button>
        </div>
      )}

      
      <div>
        <label className="label">Category *</label>
        <SearchableSelect value={form.category}
          onChange={v => setForm(f => ({ ...f, category: v, custom_description: '', res_from_date: '', res_to_date: '' }))}
          placeholder="Select category…"
          options={[{ value: '', label: 'Select category…' }, ...categories.map(c => ({ value: c, label: c }))]}
        />
      </div>

      
      {!isIn && (
        <div>
          <label className="label">Cost On *</label>
          <SearchableSelect
            value={form.paid_by}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                paid_by: v,
                is_general: v === 'owner' ? false : f.is_general,
                owner_id: v === 'owner' ? f.owner_id : '',
                unit_id: v === 'owner' ? '' : f.unit_id,
              }))
            }
            placeholder="Cost On…"
            options={[
              { value: 'company', label: 'Company' },
              { value: 'owner', label: 'Owner' },
              { value: 'tenant', label: 'Tenant' },
            ]}
          />
          {costOnOwner && (
            <p className="mt-1 text-[11px] text-amber-700">
              Charged only to the owner you select below — not company and not you as staff
            </p>
          )}
        </div>
      )}

      
      {costOnOwner && (
        <div>
          <label className="label">Which owner pays? *</label>
          <SearchableSelect
            value={form.owner_id}
            onChange={(v) => setForm((f) => ({ ...f, owner_id: v, unit_id: '' }))}
            placeholder="Select owner…"
            options={[
              { value: '', label: 'Select owner…' },
              ...owners.map((o) => ({
                value: String(o.id),
                label: `${o.full_name}${o.unit_count != null ? ` (${o.unit_count} units)` : ''}`,
              })),
            ]}
          />
        </div>
      )}

      
      {!isIn && !costOnOwner && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="is_general"
            checked={!!form.is_general}
            onChange={e => setForm(f => ({ ...f, is_general: e.target.checked, unit_id: '' }))}
            className="w-4 h-4 rounded border-gray-300 text-primary-600"
          />
          <label htmlFor="is_general" className="text-sm font-medium text-gray-700">
            General company expense — no unit
          </label>
        </div>
      )}

      
      {(!isIn ? (costOnOwner || !form.is_general) : true) && (
        <div>
          <label className="label">
            Unit {costOnOwner || needsDates ? '*' : ''}
            {costOnOwner && !form.owner_id ? (
              <span className="ml-1 text-[11px] font-normal text-slate-400">Select an owner first</span>
            ) : null}
          </label>
          <SearchableSelect
            value={form.unit_id}
            onChange={(v) => setForm((f) => ({ ...f, unit_id: v }))}
            placeholder={costOnOwner && !form.owner_id ? 'Select owner first…' : 'Select unit…'}
            disabled={costOnOwner && !form.owner_id}
            options={[
              { value: '', label: 'Select unit…' },
              ...unitOptions.map((u) => ({
                value: String(u.id),
                label: unitSelectLabel(u),
              })),
            ]}
          />
        </div>
      )}

      
      {needsDates && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-blue-800 mb-1">Reservation Period *</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">From</label>
              <input type="date" className="input" value={form.res_from_date}
                onChange={e => setForm(f => ({ ...f, res_from_date: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">To</label>
              <input type="date" className="input" value={form.res_to_date}
                onChange={e => setForm(f => ({ ...f, res_to_date: e.target.value }))} />
            </div>
          </div>
        </div>
      )}

      
      {form.category === 'Others' && (
        <div>
          <label className="label">Description *</label>
          <input className="input" value={form.custom_description}
            onChange={e => setForm(f => ({ ...f, custom_description: e.target.value }))}
            placeholder={isIn ? 'Describe the income…' : 'Describe the expense…'} />
        </div>
      )}

      
      <div className="form-grid">
        <div>
          <label className="label">Amount (EGP) *</label>
          <input type="number" min="0" step="0.01" className="input"
            value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            placeholder="0.00" />
        </div>
        <div>
          <label className="label">Date *</label>
          <input type="date" className="input" value={form.expense_date}
            onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} />
        </div>
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder="Optional notes…" />
      </div>

      {!isIn && (
        <div>
          <label className="label">Transfer proof *</label>
          <label className="flex items-center gap-2 rounded-[10px] border border-dashed border-[#c5d0de] bg-[#f8fafc] px-3 py-3 text-sm text-[#5b6b80] cursor-pointer hover:border-[#1e5fbf]">
            <Upload className="h-4 w-4" />
            <span>{transferProof?.name || 'Upload image or PDF (required for cash out)'}</span>
            <input
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => onTransferProofChange?.(e.target.files?.[0] || null)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function PettyCashSection({ embedded = false }) {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const { user } = useAuth();

  const canMove  = can('petty_cash:move') || user?.role === 'admin';
  const canWrite = can('petty_cash:write') || user?.role === 'admin';

  const isAdminFinance = user?.role === 'admin';
  const userPCL = user?.petty_cash_location;

  const availableTabs = isAdminFinance
    ? ['east_cairo', 'west_cairo']
    : userPCL === 'both' ? ['east_cairo', 'west_cairo']
    : userPCL ? [userPCL]
    : ['east_cairo'];

  const TAB_LABELS = { east_cairo: 'East Cairo', west_cairo: 'West Cairo' };

  const [location, setLocation] = useState(availableTabs[0] || 'east_cairo');
  const [filterUnit,   setFilterUnit]   = useState('');
  const [filterPaidBy, setFilterPaidBy] = useState('');

  const [modal,  setModal]  = useState(false);
  const [editId, setEditId] = useState(null);
  const [form,   setForm]   = useState(EMPTY_FORM);
  const [transferProof, setTransferProof] = useState(null);

  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceDraft,   setBalanceDraft]   = useState('');

  const [moveTarget, setMoveTarget] = useState(null);

  const [payTarget,        setPayTarget]        = useState(null);
  const [payReservationId, setPayReservationId] = useState('');
  const [payMethod,        setPayMethod]        = useState('cash');

  
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['petty-cash', location, filterUnit, filterPaidBy],
    queryFn:  () => api.get('/petty-cash', {
      params: { location, unit_id: filterUnit || undefined, paid_by: filterPaidBy || undefined },
    }).then(r => r.data),
  });

  const { data: settings } = useQuery({
    queryKey: ['petty-cash-settings', location],
    queryFn:  () => api.get('/petty-cash/settings', { params: { location } }).then(r => r.data),
  });

  const { data: units = [] } = useQuery({
    queryKey: ['units'],
    queryFn:  () => api.get('/units').then(r => r.data),
  });

  const { data: owners = [] } = useQuery({
    queryKey: ['users-owners'],
    queryFn: () => api.get('/users/owners').then((r) => r.data),
  });

  const { data: ownerUnits = [] } = useQuery({
    queryKey: ['owner-units-for-petty', form.owner_id],
    queryFn: () => api.get(`/users/owners/${form.owner_id}/units`).then((r) => r.data),
    enabled: !!form.owner_id && form.paid_by === 'owner',
  });

  const { data: reservationsList = [] } = useQuery({
    queryKey: ['reservations-simple'],
    queryFn:  () => api.get('/reservations').then(r => {
      const payload = r.data;
      return Array.isArray(payload) ? payload : (payload?.reservations || []);
    }),
    enabled: !!payTarget,
  });

  
  const saveMutation = useMutation({
    mutationFn: (d) => {
      if (d instanceof FormData) {
        return editId
          ? api.patch(`/petty-cash/${editId}`, d)
          : api.post('/petty-cash', d);
      }
      return editId
        ? api.patch(`/petty-cash/${editId}`, d)
        : api.post('/petty-cash', d);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['petty-cash'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['finance-summary'] });
      toast.success(editId ? 'Entry updated' : 'Entry added');
      setModal(false);
      setEditId(null);
      setTransferProof(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving entry'),
  });

  const balanceMutation = useMutation({
    mutationFn: (val) => api.put('/petty-cash/settings', { opening_balance: val, location }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['petty-cash-settings'] });
      toast.success('Opening balance updated');
      setEditingBalance(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error updating balance'),
  });

  const moveMutation = useMutation({
    mutationFn: (id) => api.post(`/petty-cash/${id}/move`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['petty-cash'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Moved to Expenses ✓');
      setMoveTarget(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Move failed'),
  });

  const payMutation = useMutation({
    mutationFn: ({ id, reservation_id, payment_method }) =>
      api.post(`/petty-cash/${id}/pay`, { reservation_id, payment_method }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['petty-cash'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      toast.success('Linked to Reservation Payment ✓');
      setPayTarget(null);
      setPayReservationId('');
      setPayMethod('cash');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to link payment'),
  });

  
  const openAdd = (defaultType = 'out') => {
    setForm({ ...EMPTY_FORM, type: defaultType });
    setEditId(null);
    setTransferProof(null);
    setModal(true);
  };

  const openEdit = (entry) => {
    const isIn = entry.type === 'in';
    const categories = isIn ? IN_CATEGORIES : OUT_CATEGORIES;
    const category = categories.includes(entry.description) ? entry.description : 'Others';
    setForm({
      type:               entry.type || 'out',
      unit_id:            entry.unit_id      || '',
      category,
      custom_description: category === 'Others' ? (entry.description || '') : '',
      amount:             entry.amount       || '',
      paid_by:            entry.paid_by      || 'company',
      owner_id:           entry.owner_id != null ? String(entry.owner_id) : '',
      expense_date:       entry.expense_date ? String(entry.expense_date).split('T')[0] : '',
      res_from_date:      entry.res_from_date ? String(entry.res_from_date).split('T')[0] : '',
      res_to_date:        entry.res_to_date   ? String(entry.res_to_date).split('T')[0]   : '',
      notes:              entry.notes        || '',
      is_general:         !entry.unit_id && !isIn && entry.paid_by !== 'owner',
      is_advance:         !!entry.is_advance,
      _hasExistingProof:  !!entry.transfer_proof_path,
    });
    setEditId(entry.id);
    setTransferProof(null);
    setModal(true);
  };

  const handleSave = () => {
    const isIn = form.type === 'in';
    const requiresDates = isIn ? IN_REQUIRES_DATES : OUT_REQUIRES_DATES;
    const needsDates = requiresDates.includes(form.category);

    if (!form.category || !form.amount || !form.expense_date)
      return toast.error('Please fill all required fields');
    if (!isIn && form.paid_by === 'owner' && !form.owner_id)
      return toast.error('Select which owner pays this cost');
    if (!isIn && form.paid_by === 'owner' && !form.unit_id)
      return toast.error('Select a unit for that owner');
    if (!isIn && form.is_general && form.paid_by === 'owner')
      return toast.error('Owner costs must be linked to an owner and unit');
    if (!isIn && !form.is_general && form.paid_by !== 'owner' && !form.unit_id)
      return toast.error('Please select a unit or check "General company expense"');
    if (isIn && !form.unit_id && needsDates)
      return toast.error('Please select a unit for this category');
    if (needsDates && (!form.res_from_date || !form.res_to_date))
      return toast.error('Please enter the reservation period (From and To dates)');
    if (needsDates && form.res_from_date > form.res_to_date)
      return toast.error('Reservation period "From" must be before "To"');
    if (form.category === 'Others' && !form.custom_description.trim())
      return toast.error('Please enter a description for Others');
    if (!isIn && !editId && !transferProof)
      return toast.error('Upload a transfer proof for cash out');
    if (!isIn && editId && !transferProof && !form._hasExistingProof)
      return toast.error('Upload a transfer proof for cash out');

    const description = form.category === 'Others'
      ? form.custom_description.trim()
      : form.category;

    const payload = {
      unit_id:      form.unit_id || null,
      owner_id:     !isIn && form.paid_by === 'owner' ? form.owner_id : null,
      description,
      amount:       form.amount,
      paid_by:      isIn ? 'company' : form.paid_by,
      expense_date: form.expense_date,
      notes:        form.notes,
      type:         form.type,
      location,
      is_advance:   isIn ? form.is_advance : false,
      res_from_date: needsDates ? form.res_from_date : undefined,
      res_to_date:   needsDates ? form.res_to_date   : undefined,
    };

    if (!isIn && transferProof) {
      const fd = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        fd.append(key, String(value));
      });
      fd.append('transfer_proof', transferProof);
      saveMutation.mutate(fd);
      return;
    }

    saveMutation.mutate(payload);
  };

  const startEditBalance = () => {
    setBalanceDraft(String(settings?.opening_balance ?? 0));
    setEditingBalance(true);
  };

  const confirmEditBalance = () => {
    const val = parseFloat(balanceDraft);
    if (isNaN(val)) return toast.error('Please enter a valid number');
    balanceMutation.mutate(val);
  };

  const openPayModal = (entry) => {
    setPayTarget(entry);
    setPayReservationId('');
    setPayMethod('cash');
  };

  const handlePay = () => {
    if (!payReservationId) return toast.error('Please select a reservation');
    payMutation.mutate({ id: payTarget.id, reservation_id: payReservationId, payment_method: payMethod });
  };

  
  const openingBalance = parseFloat(settings?.opening_balance ?? 0);
  const activeEntries  = entries.filter(e => e.status !== 'moved');
  const totalIn        = activeEntries.filter(e => e.type === 'in').reduce((s, e) => s + parseFloat(e.amount), 0);
  const totalOut       = activeEntries.filter(e => e.type !== 'in').reduce((s, e) => s + parseFloat(e.amount), 0);
  const currentBalance = openingBalance + totalIn - totalOut;

  const { sorted: sortedEntries, sortKey, sortDir, handleSort } = useSortableTable(entries, 'expense_date', 'desc');

  let running = openingBalance;
  const entriesWithBalance = sortedEntries.map(e => {
    const amt = parseFloat(e.amount) || 0;
    const isMoved = e.status === 'moved';
    if (!isMoved) running = e.type === 'in' ? running + amt : running - amt;
    return { ...e, _runningBalance: isMoved ? null : running };
  });

  
  const modalTitle = editId
    ? 'Edit Entry'
    : form.type === 'in'
      ? (form.is_advance ? 'New Entry — عهدة / Advance' : 'New Entry — Cash In')
      : 'New Entry — Cash Out';

  return (
    <div className="space-y-6">

      
      {availableTabs.length > 1 && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {availableTabs.map(tab => (
            <button key={tab} onClick={() => setLocation(tab)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                location === tab ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
      )}
      {availableTabs.length === 1 && (
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-600">
          <span>{TAB_LABELS[availableTabs[0]]}</span>
        </div>
      )}

      
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className={embedded ? '' : 'page-header mb-0'}>
          {embedded ? (
            <>
              <h3 className="font-semibold text-gray-900">Petty cash — {TAB_LABELS[location]}</h3>
              <p className="text-xs text-gray-500 mt-1">
                Cash drawer in/out. Owner-paid outs post to the owner statement; company outs stay here until moved.
              </p>
            </>
          ) : (
            <>
              <h1 className="page-title">Petty Cash — {TAB_LABELS[location]}</h1>
              <p className="page-subtitle">
                Cash drawer tracking. Owner-paid outs are charged to the owner statement immediately.
              </p>
            </>
          )}
        </div>
        {canWrite && (
          <button onClick={() => openAdd('out')} className="btn-primary">
            <Plus className="w-4 h-4" />Add Entry
          </button>
        )}
      </div>

      
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card py-4 text-center relative">
          <p className="text-xs text-gray-400 mb-1">Opening Balance</p>
          {editingBalance ? (
            <div className="flex items-center justify-center gap-1 mt-1">
              <input type="number" step="0.01" className="input text-center text-sm w-28 py-1"
                value={balanceDraft} onChange={e => setBalanceDraft(e.target.value)} autoFocus
                onKeyDown={e => { if (e.key === 'Enter') confirmEditBalance(); if (e.key === 'Escape') setEditingBalance(false); }} />
              <button onClick={confirmEditBalance} disabled={balanceMutation.isPending}
                className="p-1 rounded-lg text-emerald-600 hover:bg-emerald-50"><Check className="w-4 h-4" /></button>
              <button onClick={() => setEditingBalance(false)}
                className="p-1 rounded-lg text-gray-400 hover:bg-gray-100"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1">
              <p className="text-xl font-bold text-gray-700">{currency(openingBalance)}</p>
              {canMove && (
                <button onClick={startEditBalance}
                  className="p-1 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
                  title="Edit opening balance"><Pencil className="w-3 h-3" /></button>
              )}
            </div>
          )}
        </div>

        <div className="card py-4 text-center">
          <p className="text-xs text-gray-400 mb-1">Total Cash In</p>
          <p className="text-xl font-bold text-emerald-600">{currency(totalIn)}</p>
        </div>

        <div className="card py-4 text-center">
          <p className="text-xs text-gray-400 mb-1">Total Expenses</p>
          <p className="text-xl font-bold text-red-600">{currency(totalOut)}</p>
        </div>

        <div className={`card py-4 text-center ${currentBalance < 0 ? 'bg-red-50 border border-red-200' : ''}`}>
          <p className="text-xs text-gray-400 mb-1">Current Balance</p>
          <p className={`text-xl font-bold ${currentBalance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
            {currency(currentBalance)}
          </p>
        </div>
      </div>

      
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label text-xs">Unit</label>
          <SearchableSelect className="w-52" value={filterUnit} onChange={setFilterUnit}
            placeholder="All Units"
            options={[{ value: '', label: 'All Units' }, ...units.map((u) => ({ value: String(u.id), label: unitSelectLabel(u) }))]}
          />
        </div>
        <div>
          <label className="label text-xs">Cost On</label>
          <SearchableSelect className="w-36" value={filterPaidBy} onChange={setFilterPaidBy}
            placeholder="All"
            options={[{ value: '', label: 'All' }, { value: 'company', label: 'Company' }, { value: 'owner', label: 'Owner' }, { value: 'tenant', label: 'Tenant' }]}
          />
        </div>
        {(filterUnit || filterPaidBy) && (
          <button className="btn-secondary text-sm"
            onClick={() => { setFilterUnit(''); setFilterPaidBy(''); }}>
            Clear
          </button>
        )}
      </div>

      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
        <Wallet className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
        <span>
          Petty cash entries are <strong>completely isolated</strong> — they do not appear in Owner
          Statement, Finance Reports, or Expenses until an Admin or Finance user moves them.
        </span>
      </div>

      
      {isLoading ? (
        <LoadingSpinner />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No petty cash entries"
          subtitle="Add an expense or record cash in to start tracking"
          action={canWrite && <button onClick={() => openAdd('out')} className="btn-primary"><Plus className="w-4 h-4" />Add Entry</button>}
        />
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>#</th>
                <SortTh col="type" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Type</SortTh>
                <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Unit</SortTh>
                <SortTh col="description" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Description</SortTh>
                <SortTh col="amount" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right">Amount</SortTh>
                <SortTh col="paid_by" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-center">Cost On</SortTh>
                <th>Created By</th>
                <SortTh col="expense_date" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Date</SortTh>
                <th className="text-right font-semibold text-gray-700">Balance</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entriesWithBalance.map((entry, i) => {
                const isMoved  = entry.status === 'moved';
                const isCashIn = entry.type === 'in';
                const movedLabel  = entry.moved_to === 'payment' ? 'Moved to Payment' : 'Moved to Expenses';
                const movedColors = entry.moved_to === 'payment'
                  ? 'bg-purple-100 text-purple-700'
                  : 'bg-emerald-100 text-emerald-700';
                return (
                  <tr key={entry.id} className={isMoved ? 'bg-gray-50 opacity-70' : isCashIn ? 'bg-emerald-50/40' : ''}>
                    <td className="text-gray-400 text-xs">{i + 1}</td>

                    
                    <td>
                      {isCashIn ? (
                        entry.is_advance ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                            <TrendingUp className="w-3 h-3" />عهدة
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                            <TrendingUp className="w-3 h-3" />In
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                          <TrendingDown className="w-3 h-3" />Out
                        </span>
                      )}
                    </td>

                    <td>
                      {unitDisplay(entry) !== '—' ? (
                        <>
                          <div className="font-medium text-gray-900">
                            {unitDisplay(entry)}
                          </div>
                          {entry.project && <div className="text-xs text-gray-400">{entry.project}</div>}
                        </>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>

                    <td>
                      <div className="max-w-xs">
                        <p className={isMoved ? 'text-gray-400' : 'text-gray-800'}>{entry.description}</p>
                        {entry.res_from_date && (
                          <p className="text-xs text-blue-600 font-medium mt-0.5">
                            📅 {String(entry.res_from_date).split('T')[0]} → {String(entry.res_to_date || '').split('T')[0]}
                          </p>
                        )}
                        {entry.notes && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{entry.notes}</p>}
                      </div>
                    </td>

                    <td className={`text-right tabular-nums font-semibold ${isCashIn ? 'text-emerald-700' : 'text-gray-900'}`}>
                      {isCashIn ? '+' : ''}{currency(entry.amount)}
                    </td>

                    <td className="text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        <PaidByBadge paidBy={entry.paid_by} />
                        {entry.paid_by === 'owner' && entry.owner_name && (
                          <span className="text-[11px] text-amber-800 font-medium">{entry.owner_name}</span>
                        )}
                      </div>
                    </td>

                    <td className="text-gray-600 text-sm">{entry.created_by_name || '—'}</td>

                    <td className="whitespace-nowrap text-gray-500">
                      {formatDate(entry.expense_date)}
                    </td>

                    
                    <td className="text-right tabular-nums">
                      {isMoved ? (
                        <span className="text-gray-300 text-xs">—</span>
                      ) : (
                        <span className={`font-semibold text-sm ${entry._runningBalance < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                          {currency(entry._runningBalance)}
                        </span>
                      )}
                    </td>

                    
                    <td>
                      {isMoved ? (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${movedColors}`}>
                          ✓ {movedLabel}
                        </span>
                      ) : (
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {canWrite && (
                            <button onClick={() => openEdit(entry)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="Edit entry">
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canMove && !isCashIn && (
                            <button onClick={() => setMoveTarget(entry)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors">
                              <ArrowRightCircle className="w-3.5 h-3.5" />
                              Expenses
                            </button>
                          )}
                          {canMove && !isCashIn && (
                            <button onClick={() => openPayModal(entry)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 transition-colors">
                              <CreditCard className="w-3.5 h-3.5" />
                              Payment
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <td colSpan={4} className="text-right text-gray-600 pr-4">Current Balance</td>
                <td colSpan={4} />
                <td className={`text-right tabular-nums text-sm ${currentBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {currency(currentBalance)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      
      <Modal
        open={modal}
        onClose={() => { setModal(false); setEditId(null); }}
        title={modalTitle}
        size="md"
        footer={
          <>
            <button onClick={() => { setModal(false); setEditId(null); }} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saveMutation.isPending}
              className={`btn-primary ${form.type === 'in' ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-600' : ''}`}>
              {saveMutation.isPending ? 'Saving…' : editId ? 'Save Changes' : 'Add Entry'}
            </button>
          </>
        }
      >
        <EntryForm
          form={form}
          setForm={setForm}
          units={units}
          owners={owners.filter((o) => o.is_active == null || Number(o.is_active) === 1)}
          ownerUnits={ownerUnits}
          transferProof={transferProof}
          onTransferProofChange={setTransferProof}
        />
      </Modal>

      
      <ConfirmDialog
        open={!!moveTarget}
        onClose={() => setMoveTarget(null)}
        onConfirm={() => moveMutation.mutate(moveTarget?.id)}
        loading={moveMutation.isPending}
        title="Move to Expenses?"
        message={
          moveTarget
            ? `This will permanently move "${moveTarget.description}" (${currency(moveTarget.amount)}) to the Expenses tab and remove it from Petty Cash. This action cannot be undone.`
            : ''
        }
        confirmText="Yes, Move to Expenses"
        danger={false}
      />

      
      <Modal
        open={!!payTarget}
        onClose={() => { setPayTarget(null); setPayReservationId(''); setPayMethod('cash'); }}
        title="Link to Reservation Payment"
        size="md"
        footer={
          <>
            <button onClick={() => setPayTarget(null)} className="btn-secondary">Cancel</button>
            <button onClick={handlePay} disabled={payMutation.isPending} className="btn-primary">
              {payMutation.isPending ? 'Linking…' : 'Link as Payment'}
            </button>
          </>
        }
      >
        {payTarget && (
          <div className="space-y-4">
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-sm text-purple-800">
              <p className="font-semibold">{payTarget.description}</p>
              <p className="text-lg font-bold mt-0.5">{currency(payTarget.amount)}</p>
              <p className="text-xs text-purple-600 mt-1">
                This amount will be recorded as a cash payment on the selected reservation and removed from Petty Cash.
              </p>
            </div>
            <div>
              <label className="label">Reservation *</label>
              <SearchableSelect value={payReservationId} onChange={setPayReservationId}
                placeholder="Select reservation…"
                options={[{ value: '', label: 'Select reservation…' }, ...reservationsList.map((r) => ({
                  value: String(r.id),
                  label: `${r.guest_name} — ${unitDisplay(r, '')} (${String(r.check_in).split('T')[0]})`,
                }))]}
              />
            </div>
            <div>
              <label className="label">Payment Method</label>
              <SearchableSelect value={payMethod} onChange={setPayMethod}
                placeholder="Payment Method…"
                options={[{ value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Bank Transfer' }, { value: 'credit_card', label: 'Credit Card' }, { value: 'check', label: 'Check' }]}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function PettyCash() {
  return <PettyCashSection />;
}
