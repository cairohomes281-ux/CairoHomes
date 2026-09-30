import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { Home, DollarSign, ClipboardList, Download, Sparkles, CheckCircle2, SprayCan, History } from 'lucide-react';
import * as XLSX from 'xlsx';
import SearchableSelect from '../components/ui/SearchableSelect';
import { usePermissions } from '../hooks/usePermissions';
import { useAuth } from '../context/AuthContext';
import { canAccess } from '../utils/permissions';
import { useSortableTable } from '../hooks/useSortableTable';
import SortTh from '../components/ui/SortTh';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';
import { unitDisplay, unitSelectLabel } from '../utils/formatters';
import { TodayCleansSection } from './HkTodayCleans';
import { CleansHistorySection } from './HkCleansHistory';

const fmt = (n) =>
  Number(n || 0).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const normDate = (d) => (d ? String(d).split('T')[0] : '');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function booksFrom() {
  const d = new Date();
  const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  return monthStart < FINANCIAL_EPOCH ? FINANCIAL_EPOCH : monthStart;
}

function StatusBadge({ status }) {
  const map = {
    confirmed: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    cancelled: 'bg-red-100 text-red-800',
    checked_in: 'bg-blue-100 text-blue-800',
    checked_out: 'bg-gray-100 text-gray-700',
    accepted: 'bg-blue-100 text-blue-800',
    in_progress: 'bg-amber-100 text-amber-800',
    submitted: 'bg-indigo-100 text-indigo-800',
    needs_reclean: 'bg-red-100 text-red-800',
    ready: 'bg-emerald-100 text-emerald-800',
  };
  const label = status
    ? status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '-';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {label}
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{label}</p>
        <p className="text-xl font-bold text-gray-800 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function TasksTab() {
  const qc = useQueryClient();
  const { isAdmin } = usePermissions();
  const [statusFilter, setStatusFilter] = useState('');

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['housekeeping-tasks', statusFilter],
    queryFn: () =>
      api
        .get('/housekeeping-tasks', { params: statusFilter ? { status: statusFilter } : {} })
        .then((r) => r.data),
  });

  const patch = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/housekeeping-tasks/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['housekeeping-tasks'] });
      toast.success('Task updated');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const submit = useMutation({
    mutationFn: (id) => api.post(`/housekeeping-tasks/${id}/submit`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['housekeeping-tasks'] });
      toast.success('Submitted for inspection');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Submit failed'),
  });

  const inspect = useMutation({
    mutationFn: ({ id, result }) => api.post(`/housekeeping-tasks/${id}/inspect`, { result }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['housekeeping-tasks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Inspection recorded');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Inspection failed'),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {['pending', 'accepted', 'in_progress', 'submitted', 'needs_reclean', 'ready', 'cancelled'].map(
            (s) => (
              <option key={s} value={s}>
                {s}
              </option>
            )
          )}
        </select>
        <p className="text-sm text-gray-500">{tasks.length} tasks</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 py-12 text-center">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center text-gray-400 text-sm">
          No housekeeping tasks yet. Tasks auto-create ~24h before check-in.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {tasks.map((t) => (
            <div key={t.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{unitDisplay(t)}</p>
                  <p className="text-xs text-gray-500">
                    Unit ID: {t.unit_number || t.unit_uuid || '—'}
                    {t.project ? ` · ${t.project}` : ''}
                  </p>
                  {t.source === 'guest_request' ? (
                    <p className="mt-1 text-xs font-medium text-violet-700">Guest request</p>
                  ) : (
                    <p className="text-xs text-gray-500">Check-in {normDate(t.check_in) || '—'}</p>
                  )}
                </div>
                <StatusBadge status={t.status} />
              </div>
              {t.source === 'guest_request' && (
                <div className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900 space-y-1">
                  <p>
                    <span className="font-semibold">Requested time:</span>{' '}
                    {t.requested_time || (t.due_at ? String(t.due_at) : '—')}
                  </p>
                  <p>
                    <span className="font-semibold">Phone:</span> {t.guest_phone || '—'}
                  </p>
                </div>
              )}
              {t.guest_name_internal && (
                <p className="text-sm text-gray-600">Guest: {t.guest_name_internal}</p>
              )}
              {t.source !== 'guest_request' && t.guest_phone && (
                <p className="text-xs text-gray-500">Phone: {t.guest_phone}</p>
              )}
              <ul className="text-xs text-gray-600 space-y-1">
                {(Array.isArray(t.checklist) ? t.checklist : []).slice(0, 6).map((c) => (
                  <li key={c.key || c.label} className="flex items-center gap-2">
                    <CheckCircle2 className={`w-3.5 h-3.5 ${c.done ? 'text-emerald-500' : 'text-gray-300'}`} />
                    {c.label}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2 pt-1">
                {t.status === 'pending' && (
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => patch.mutate({ id: t.id, body: { status: 'accepted' } })}
                  >
                    Accept
                  </button>
                )}
                {['accepted', 'needs_reclean'].includes(t.status) && (
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => patch.mutate({ id: t.id, body: { status: 'in_progress' } })}
                  >
                    Start
                  </button>
                )}
                {t.status === 'in_progress' && (
                  <button className="btn-primary text-xs" onClick={() => submit.mutate(t.id)}>
                    Submit for inspection
                  </button>
                )}
                {t.status === 'submitted' && isAdmin && (
                  <>
                    <button
                      className="btn-primary text-xs"
                      onClick={() => inspect.mutate({ id: t.id, result: 'pass' })}
                    >
                      Pass
                    </button>
                    <button
                      className="btn-secondary text-xs text-red-600"
                      onClick={() => inspect.mutate({ id: t.id, result: 'fail' })}
                    >
                      Fail / re-clean
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FeesTab() {
  const { isAdmin } = usePermissions();
  const [fromDate, setFromDate] = useState(booksFrom());
  const [toDate, setToDate] = useState(todayStr());
  const [unitId, setUnitId] = useState('');
  const [project, setProject] = useState('');
  const [search, setSearch] = useState('');

  const { data: unitsData } = useQuery({
    queryKey: ['units-list'],
    queryFn: () => api.get('/units').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const params = {};
  if (fromDate) params.from_date = fromDate;
  if (toDate) params.to_date = toDate;
  if (unitId) params.unit_id = unitId;
  if (project) params.project = project;

  const { data, isLoading, error } = useQuery({
    queryKey: ['housekeeping', fromDate, toDate, unitId, project],
    queryFn: () => api.get('/housekeeping', { params }).then((r) => r.data),
    staleTime: 60 * 1000,
  });

  const rows = useMemo(() => {
    const all = data?.rows || [];
    if (!search.trim()) return all;
    const q = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (r.guest_name || '').toLowerCase().includes(q) ||
        unitDisplay(r, '').toLowerCase().includes(q)
    );
  }, [data, search]);

  const projects = useMemo(() => {
    if (data?.projects?.length) return data.projects;
    if (unitsData) return [...new Set(unitsData.map((u) => u.project).filter(Boolean))].sort();
    return [];
  }, [data, unitsData]);

  const units = useMemo(() => {
    if (!unitsData) return [];
    if (!project) return unitsData;
    return unitsData.filter((u) => u.project === project);
  }, [unitsData, project]);

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(rows, 'check_in', 'desc');
  const visibleTotal = useMemo(
    () => rows.reduce((s, r) => s + parseFloat(r.housekeeping_fees || 0), 0),
    [rows]
  );

  function handleExport() {
    const exportRows = rows.map((r) => ({
      'Reservation ID': r.id,
      Unit: unitDisplay(r, ''),
      Project: r.project || '',
      Guest: r.guest_name,
      'Check-in': normDate(r.check_in),
      'Check-out': normDate(r.check_out),
      Nights: r.nights,
      Status: r.status,
      'Housekeeping Fee': parseFloat(r.housekeeping_fees || 0),
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Housekeeping Fees');
    XLSX.writeFile(wb, `housekeeping_fees_${fromDate}_${toDate}.xlsx`);
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="flex justify-end">
          <button
            onClick={handleExport}
            disabled={!rows.length}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
          >
            <Download className="w-4 h-4" />
            Export Excel
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          icon={DollarSign}
          label="Total Housekeeping Fees"
          value={`EGP ${fmt(data?.summary?.total ?? 0)}`}
          color="bg-emerald-500"
        />
        <SummaryCard
          icon={ClipboardList}
          label="Reservations (filtered)"
          value={(data?.summary?.count ?? 0).toLocaleString()}
          color="bg-blue-500"
        />
        <SummaryCard
          icon={Home}
          label="Shown (after search)"
          value={`EGP ${fmt(visibleTotal)}`}
          color="bg-indigo-500"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">From</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">To</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Project</label>
            <SearchableSelect
              value={project}
              onChange={(v) => {
                setProject(v);
                setUnitId('');
              }}
              placeholder="All Projects"
              options={[{ value: '', label: 'All Projects' }, ...projects.map((p) => ({ value: p, label: p }))]}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Unit</label>
            <SearchableSelect
              value={unitId}
              onChange={setUnitId}
              placeholder="All Units"
              options={[
                { value: '', label: 'All Units' },
                ...units.map((u) => ({ value: String(u.id), label: unitSelectLabel(u, { withProject: false }) })),
              ]}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1 font-medium">Search Guest / Unit</label>
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-red-500 text-sm">Failed to load data</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 text-sm gap-2">
            <Home className="w-8 h-8 opacity-30" />
            <span>No housekeeping fees found for the selected filters</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800 text-white text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">#</th>
                  <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">
                    Unit
                  </SortTh>
                  <SortTh col="guest_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">
                    Guest
                  </SortTh>
                  <SortTh col="check_in" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">
                    Check-in
                  </SortTh>
                  <SortTh col="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-4 py-3 text-left">
                    Status
                  </SortTh>
                  <SortTh
                    col="housekeeping_fees"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="px-4 py-3 text-right"
                  >
                    Fee
                  </SortTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((r, idx) => (
                  <tr key={r.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3 text-gray-400 text-xs">{r.id}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{unitDisplay(r)}</td>
                    <td className="px-4 py-3 text-gray-700">{r.guest_name}</td>
                    <td className="px-4 py-3 text-gray-600">{normDate(r.check_in)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                      EGP {fmt(r.housekeeping_fees)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const EMPTY_SERVICE_FORM = {
  client_name: '',
  client_phone: '',
  unit_number: '',
  amount: '',
  period_start: todayStr(),
  period_end: todayStr(),
  notes: '',
};

const SERVICE_STATUSES = ['requested', 'scheduled', 'done', 'cancelled'];

function ServicesTab() {
  const qc = useQueryClient();
  const { isAdmin } = usePermissions();
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_SERVICE_FORM);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['hk-service-orders', statusFilter],
    queryFn: () =>
      api
        .get('/housekeeping-service-orders', {
          params: statusFilter ? { status: statusFilter } : { include_cancelled: '1' },
        })
        .then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: (d) => api.post('/housekeeping-service-orders', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hk-service-orders'] });
      qc.invalidateQueries({ queryKey: ['finance-summary'] });
      toast.success('Service request added');
      setForm(EMPTY_SERVICE_FORM);
      setShowForm(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to add request'),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/housekeeping-service-orders/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hk-service-orders'] });
      qc.invalidateQueries({ queryKey: ['finance-summary'] });
      toast.success('Updated');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const submit = () => {
    if (!form.client_name.trim()) return toast.error('Client name is required');
    if (!form.unit_number.trim()) return toast.error('Unit number is required');
    if (!form.amount || Number(form.amount) < 0) return toast.error('Valid amount is required');
    if (!form.period_start || !form.period_end) return toast.error('Period is required');
    if (form.period_end < form.period_start) return toast.error('Period end must be after start');
    create.mutate(form);
  };

  const activeOrders = orders.filter((o) => o.status !== 'cancelled');
  const totalRevenue = activeOrders.reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard
          icon={DollarSign}
          label="Service Revenue"
          value={`EGP ${fmt(totalRevenue)}`}
          color="bg-emerald-500"
        />
        <SummaryCard
          icon={ClipboardList}
          label="Requests"
          value={activeOrders.length.toLocaleString()}
          color="bg-blue-500"
        />
        <SummaryCard
          icon={Sparkles}
          label="Scheduled / Requested"
          value={activeOrders
            .filter((o) => o.status === 'requested' || o.status === 'scheduled')
            .length.toLocaleString()}
          color="bg-indigo-500"
        />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="w-44">
          <SearchableSelect
            value={statusFilter}
            onChange={setStatusFilter}
            placeholder="All statuses"
            options={[
              { value: '', label: 'All statuses' },
              ...SERVICE_STATUSES.map((s) => ({
                value: s,
                label: s.replace(/\b\w/g, (c) => c.toUpperCase()),
              })),
            ]}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-ch-pine text-white rounded-lg text-sm font-medium hover:opacity-90"
        >
          {showForm ? 'Close form' : '+ Add request'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <p className="text-sm font-semibold text-gray-800">
            New housekeeping request (outside client — no reservation needed)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium">Client name *</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.client_name}
                onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
                placeholder="e.g. Mohamed Salah"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium">Phone</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.client_phone}
                onChange={(e) => setForm((f) => ({ ...f, client_phone: e.target.value }))}
                placeholder="01xxxxxxxxx"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium">
                Unit number * (type it — any unit)
              </label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.unit_number}
                onChange={(e) => setForm((f) => ({ ...f, unit_number: e.target.value }))}
                placeholder="e.g. B-124, Zamalek Flat 7"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium">
                Amount to be paid (EGP) *
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium">Period from *</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.period_start}
                onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 font-medium">Period to *</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={form.period_end}
                onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs text-gray-500 mb-1 font-medium">Notes</label>
              <textarea
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Special instructions…"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={create.isPending}
              onClick={submit}
              className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {create.isPending ? 'Saving…' : 'Save request'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading…</div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 text-sm gap-2">
            <Sparkles className="w-8 h-8 opacity-30" />
            <span>No service requests yet — add one for an outside client</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800 text-white text-xs uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Client</th>
                  <th className="px-4 py-3 text-left">Unit #</th>
                  <th className="px-4 py-3 text-left">Period</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o, idx) => (
                  <tr key={o.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{o.client_name}</div>
                      {o.client_phone && <div className="text-xs text-gray-400">{o.client_phone}</div>}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-700">{o.unit_number}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {normDate(o.period_start)} → {normDate(o.period_end)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                      EGP {fmt(o.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={o.status} />
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      {o.status === 'requested' && (
                        <button
                          className="text-xs text-blue-700 font-medium"
                          onClick={() => setStatus.mutate({ id: o.id, status: 'scheduled' })}
                        >
                          Schedule
                        </button>
                      )}
                      {(o.status === 'requested' || o.status === 'scheduled') && (
                        <>
                          <button
                            className="text-xs text-emerald-700 font-medium"
                            onClick={() => setStatus.mutate({ id: o.id, status: 'done' })}
                          >
                            Mark done
                          </button>
                          {isAdmin && (
                            <button
                              className="text-xs text-red-600 font-medium"
                              onClick={() => setStatus.mutate({ id: o.id, status: 'cancelled' })}
                            >
                              Cancel
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Housekeeping() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'today';
  const tabAliases = {
    today: 'today',
    history: 'history',
    tasks: 'tasks',
    fees: 'fees',
    services: 'services',
  };
  const activeTab = tabAliases[rawTab] || 'today';

  const tabs = [
    { id: 'today', label: "Today's cleans", icon: SprayCan, page: 'hk_today' },
    { id: 'history', label: 'Cleans history', icon: History, page: 'hk_today' },
    // Fees / Tasks money surfaces removed for ops; admin-only if housekeeping page still reachable
    ...(user?.role === 'admin'
      ? [
          { id: 'tasks', label: 'Tasks', icon: Sparkles, page: 'housekeeping' },
          { id: 'fees', label: 'Fees', icon: DollarSign, page: 'housekeeping' },
          { id: 'services', label: 'Service requests', icon: ClipboardList, page: 'housekeeping' },
        ]
      : []),
  ].filter((t) => canAccess(user, t.page));

  const resolvedTab = tabs.some((t) => t.id === activeTab) ? activeTab : tabs[0]?.id || 'today';

  function setTab(id) {
    setSearchParams({ tab: id }, { replace: true });
  }

  return (
    <div className="p-6 space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Housekeeping</h1>
        <p className="page-subtitle">
          Today&apos;s cleans, history, readiness tasks, fees, and service requests
        </p>
      </div>

      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = resolvedTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-white text-ch-pine shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {resolvedTab === 'today' ? <TodayCleansSection embedded /> : null}
      {resolvedTab === 'history' ? <CleansHistorySection embedded /> : null}
      {resolvedTab === 'tasks' ? <TasksTab /> : null}
      {resolvedTab === 'fees' ? <FeesTab /> : null}
      {resolvedTab === 'services' ? <ServicesTab /> : null}
    </div>
  );
}
