import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CalendarDays,
  Handshake,
  Trophy,
  Users,
  ClipboardList,
  Target,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, isResaleManager } from '../utils/permissions';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import { currency } from '../utils/formatters';

function defaultRange() {
  const to = new Date().toISOString().slice(0, 10);
  const fromDt = new Date(`${to}T12:00:00Z`);
  fromDt.setUTCDate(fromDt.getUTCDate() - 29);
  return { from: fromDt.toISOString().slice(0, 10), to };
}

function currentPeriod() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function monthInputValue(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function parseMonthInput(value) {
  const [y, m] = String(value || '').split('-').map(Number);
  if (!y || !m) return currentPeriod();
  return { year: y, month: m };
}

function formatDay(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function medal(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `${rank}`;
}

function DateRangePicker({ fromDate, toDate, setFromDate, setToDate }) {
  return (
    <div className="card p-3 flex flex-wrap items-end gap-3">
      <div>
        <label className="label text-xs">From</label>
        <input
          type="date"
          className="input w-40"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
      </div>
      <div>
        <label className="label text-xs">To</label>
        <input
          type="date"
          className="input w-40"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />
      </div>
    </div>
  );
}

function DailyBars({ rows, title, subtitle, emptyTitle }) {
  const maxDaily = useMemo(
    () => Math.max(1, ...rows.map((row) => Number(row.count) || 0)),
    [rows]
  );

  return (
    <section className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-ch-line">
        <h2 className="font-semibold text-ch-pine">{title}</h2>
        {subtitle ? <p className="text-xs text-ch-muted mt-0.5">{subtitle}</p> : null}
      </div>
      {!rows.length ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <ul className="max-h-[28rem] overflow-y-auto divide-y divide-ch-line/70">
          {rows.map((row) => (
            <li key={row.date} className="px-5 py-2.5 flex items-center gap-3">
              <span className="w-28 shrink-0 text-xs text-ch-muted">{formatDay(row.date)}</span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round((Number(row.count) / maxDaily) * 100)}%`,
                    background: 'var(--pms-accent)',
                  }}
                />
              </div>
              <span className="w-8 text-right text-sm font-semibold tabular-nums text-ch-pine">
                {row.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MonthlyTargetsPanel() {
  const qc = useQueryClient();
  const initial = currentPeriod();
  const [period, setPeriod] = useState(initial);
  const [editRow, setEditRow] = useState(null);
  const [form, setForm] = useState({
    target_bookings: '20',
    bonus_amount: '500',
    deduction_amount: '500',
  });
  const [bulk, setBulk] = useState({
    target_bookings: '20',
    bonus_amount: '500',
    deduction_amount: '500',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['reservation-targets', period.year, period.month],
    queryFn: () =>
      api
        .get('/reservation-targets', { params: { year: period.year, month: period.month } })
        .then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (payload) => api.put('/reservation-targets', payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reservation-targets'] });
      toast.success('Target saved');
      setEditRow(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save target'),
  });

  const bulkMutation = useMutation({
    mutationFn: (payload) => api.post('/reservation-targets/bulk', payload).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['reservation-targets'] });
      toast.success(`Targets set for ${res.updated} agent(s)${res.skipped ? ` · ${res.skipped} already applied` : ''}`);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not set targets'),
  });

  const applyMutation = useMutation({
    mutationFn: (payload) => api.post('/reservation-targets/apply', payload).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['reservation-targets'] });
      toast.success(
        `Applied · ${res.summary?.bonuses || 0} bonus(es), ${res.summary?.deductions || 0} deduction(s)`
      );
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not apply targets'),
  });

  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const openCount = rows.filter((r) => r.status === 'open' || r.status === 'unset').length;
  const applyable = rows.filter((r) => r.status === 'open').length;

  const openEdit = (row) => {
    setEditRow(row);
    setForm({
      target_bookings: String(row.target_bookings ?? 20),
      bonus_amount: String(row.bonus_amount ?? 500),
      deduction_amount: String(row.deduction_amount ?? 500),
    });
  };

  return (
    <section className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-ch-line flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Target className="w-4 h-4 mt-1" style={{ color: 'var(--pms-accent)' }} />
          <div>
            <h2 className="font-semibold text-ch-pine">Monthly booking targets</h2>
            <p className="text-xs text-ch-muted mt-0.5">
              Set a booking target for each agent. Hit it → salary bonus. Miss it → performance deduction.
              Apply at month end to post payroll lines.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label text-xs">Month</label>
            <input
              type="month"
              className="input w-40"
              value={monthInputValue(period.year, period.month)}
              onChange={(e) => setPeriod(parseMonthInput(e.target.value))}
            />
          </div>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={!applyable || applyMutation.isPending}
            onClick={() => {
              if (
                !window.confirm(
                  `Apply open targets for ${monthInputValue(period.year, period.month)}?\nAgents who hit the target get a bonus; those who miss get a deduction on payroll.`
                )
              ) {
                return;
              }
              applyMutation.mutate({ year: period.year, month: period.month });
            }}
          >
            {applyMutation.isPending ? 'Applying…' : `Apply month (${applyable})`}
          </button>
        </div>
      </div>

      <div className="px-5 py-4 border-b border-ch-line bg-ch-pine-50/40">
        <p className="text-xs font-semibold text-ch-pine mb-2">Set same target for all agents</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label text-xs">Bookings target</label>
            <input
              type="number"
              min="0"
              step="1"
              className="input w-28"
              value={bulk.target_bookings}
              onChange={(e) => setBulk((f) => ({ ...f, target_bookings: e.target.value }))}
            />
          </div>
          <div>
            <label className="label text-xs">Bonus if hit (EGP)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input w-32"
              value={bulk.bonus_amount}
              onChange={(e) => setBulk((f) => ({ ...f, bonus_amount: e.target.value }))}
            />
          </div>
          <div>
            <label className="label text-xs">Deduction if miss (EGP)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input w-36"
              value={bulk.deduction_amount}
              onChange={(e) => setBulk((f) => ({ ...f, deduction_amount: e.target.value }))}
            />
          </div>
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={bulkMutation.isPending || !openCount}
            onClick={() =>
              bulkMutation.mutate({
                year: period.year,
                month: period.month,
                target_bookings: Number(bulk.target_bookings),
                bonus_amount: Number(bulk.bonus_amount),
                deduction_amount: Number(bulk.deduction_amount),
              })
            }
          >
            {bulkMutation.isPending ? 'Saving…' : 'Apply to all'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ch-muted">
          {totals.hitting ?? 0} hitting · {totals.missing ?? 0} missing · {totals.applied ?? 0} already applied
        </p>
      </div>

      {isLoading ? (
        <div className="p-8">
          <LoadingSpinner />
        </div>
      ) : !rows.length ? (
        <EmptyState title="No reservation agents" subtitle="Add active web or manual reservation staff in Users." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ch-muted border-b border-ch-line">
                <th className="px-5 py-2.5 font-semibold">Agent</th>
                <th className="px-3 py-2.5 font-semibold text-right">Bookings</th>
                <th className="px-3 py-2.5 font-semibold text-right">Target</th>
                <th className="px-3 py-2.5 font-semibold text-right">Bonus</th>
                <th className="px-3 py-2.5 font-semibold text-right">Deduction</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-5 py-2.5 font-semibold text-right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.staff_user_id} className="border-b border-ch-line/70 last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium text-ch-pine">{row.full_name}</div>
                    <div className="text-[11px] text-ch-muted">{ROLE_LABELS[row.role] || row.role}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums font-semibold">{row.bookings_count}</td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {row.target_bookings == null ? '—' : row.target_bookings}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                    {row.bonus_amount == null ? '—' : currency(row.bonus_amount)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-rose-700">
                    {row.deduction_amount == null ? '—' : currency(row.deduction_amount)}
                  </td>
                  <td className="px-3 py-3">
                    {row.status === 'applied' ? (
                      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-slate-100 text-slate-700">
                        Applied
                      </span>
                    ) : row.hit === true ? (
                      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-50 text-emerald-700">
                        On track
                      </span>
                    ) : row.hit === false ? (
                      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-rose-50 text-rose-700">
                        Behind
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-800">
                        No target
                      </span>
                    )}
                    {row.target_bookings != null ? (
                      <div className="mt-1 h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-ch-pine"
                          style={{ width: `${row.progress_pct || 0}%` }}
                        />
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {row.status !== 'applied' ? (
                      <button type="button" className="btn-secondary text-xs px-2 py-1" onClick={() => openEdit(row)}>
                        Set
                      </button>
                    ) : (
                      <span className="text-[11px] text-ch-muted">Locked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        title={editRow ? `Target · ${editRow.full_name}` : 'Target'}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditRow(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saveMutation.isPending}
              onClick={() =>
                saveMutation.mutate({
                  staff_user_id: editRow.staff_user_id,
                  year: period.year,
                  month: period.month,
                  target_bookings: Number(form.target_bookings),
                  bonus_amount: Number(form.bonus_amount),
                  deduction_amount: Number(form.deduction_amount),
                })
              }
            >
              {saveMutation.isPending ? 'Saving…' : 'Save target'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">Bookings target *</label>
            <input
              type="number"
              min="0"
              step="1"
              className="input"
              value={form.target_bookings}
              onChange={(e) => setForm((f) => ({ ...f, target_bookings: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Bonus if achieved (EGP)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={form.bonus_amount}
              onChange={(e) => setForm((f) => ({ ...f, bonus_amount: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Deduction if missed (EGP)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              value={form.deduction_amount}
              onChange={(e) => setForm((f) => ({ ...f, deduction_amount: e.target.value }))}
            />
          </div>
          <p className="text-xs text-ch-muted">
            Current bookings this month: <strong>{editRow?.bookings_count ?? 0}</strong>
          </p>
        </div>
      </Modal>
    </section>
  );
}

function ReservationsPerformance() {
  const { user } = useAuth();
  const initial = defaultRange();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);

  const { data, isLoading } = useQuery({
    queryKey: ['reservations-performance', fromDate, toDate],
    queryFn: () =>
      api
        .get('/reservations-performance', {
          params: { from_date: fromDate || undefined, to_date: toDate || undefined },
        })
        .then((r) => r.data),
  });

  const totals = data?.totals || { total: 0, today: 0, team_size: 0 };
  const daily = data?.daily || [];
  const leaderboard = data?.leaderboard || [];

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Performance</h1>
        <p className="page-subtitle">
          {user?.role === 'admin'
            ? 'Reservation counts and monthly targets for every reservations agent.'
            : 'Team booking pace, leaderboard, and monthly targets (bonus if hit, deduction if missed).'}
        </p>
      </div>

      <MonthlyTargetsPanel />

      <DateRangePicker
        fromDate={fromDate}
        toDate={toDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3 text-ch-muted text-xs font-semibold uppercase tracking-wide">
            <ClipboardList className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Reservations in range
          </div>
          <p className="mt-2 font-display text-3xl text-ch-pine">{totals.total}</p>
          <p className="mt-1 text-xs text-ch-muted">
            Created {fromDate} – {toDate}
          </p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-ch-muted text-xs font-semibold uppercase tracking-wide">
            <CalendarDays className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Done today
          </div>
          <p className="mt-2 font-display text-3xl text-ch-pine">{totals.today}</p>
          <p className="mt-1 text-xs text-ch-muted">Cairo calendar day</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-ch-muted text-xs font-semibold uppercase tracking-wide">
            <Users className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Team
          </div>
          <p className="mt-2 font-display text-3xl text-ch-pine">{totals.team_size}</p>
          <p className="mt-1 text-xs text-ch-muted">Active reservation agents</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-ch-line flex items-center gap-2">
            <Trophy className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            <h2 className="font-semibold text-ch-pine">Leaderboard</h2>
          </div>
          {!leaderboard.length ? (
            <EmptyState
              title="No team members yet"
              subtitle="Add active reservation agents in Users."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-ch-muted border-b border-ch-line">
                    <th className="px-5 py-2.5 font-semibold">Rank</th>
                    <th className="px-3 py-2.5 font-semibold">Agent</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Today</th>
                    <th className="px-5 py-2.5 font-semibold text-right">In range</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, idx) => (
                    <tr key={row.staff_id} className="border-b border-ch-line/70 last:border-0">
                      <td className="px-5 py-3 font-semibold text-ch-pine">{medal(idx + 1)}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-ch-pine">{row.full_name}</div>
                        <div className="text-[11px] text-ch-muted">
                          {ROLE_LABELS[row.role] || row.role}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.today}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-semibold">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <DailyBars
          rows={daily}
          title="Daily reservations"
          subtitle="Bookings created each day in the selected range"
          emptyTitle="No days in range"
        />
      </div>
    </div>
  );
}

function ResalePerformance() {
  const initial = defaultRange();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);

  const { data, isLoading } = useQuery({
    queryKey: ['resale-performance', fromDate, toDate],
    queryFn: () =>
      api
        .get('/resale-performance', {
          params: { from_date: fromDate || undefined, to_date: toDate || undefined },
        })
        .then((r) => r.data),
  });

  const totals = data?.totals || {
    units_total: 0,
    units_today: 0,
    sales_total: 0,
    sales_today: 0,
    team_size: 0,
  };
  const dailyUnits = data?.daily_units || [];
  const dailySales = data?.daily_sales || [];
  const leaderboard = data?.leaderboard || [];

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="page-header mb-0">
        <h1 className="page-title">Performance</h1>
        <p className="page-subtitle">
          Track resale agents — units listed for sale and signed owner requests.
        </p>
      </div>

      <DateRangePicker
        fromDate={fromDate}
        toDate={toDate}
        setFromDate={setFromDate}
        setToDate={setToDate}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3 text-ch-muted text-xs font-semibold uppercase tracking-wide">
            <Building2 className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Units added
          </div>
          <p className="mt-2 font-display text-3xl text-ch-pine">{totals.units_total}</p>
          <p className="mt-1 text-xs text-ch-muted">{fromDate} – {toDate}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-ch-muted text-xs font-semibold uppercase tracking-wide">
            <CalendarDays className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Units today
          </div>
          <p className="mt-2 font-display text-3xl text-ch-pine">{totals.units_today}</p>
          <p className="mt-1 text-xs text-ch-muted">Sale listings created today</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-ch-muted text-xs font-semibold uppercase tracking-wide">
            <Handshake className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Sales signed
          </div>
          <p className="mt-2 font-display text-3xl text-ch-pine">{totals.sales_total}</p>
          <p className="mt-1 text-xs text-ch-muted">Owner requests marked signed</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3 text-ch-muted text-xs font-semibold uppercase tracking-wide">
            <Users className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
            Team
          </div>
          <p className="mt-2 font-display text-3xl text-ch-pine">{totals.team_size}</p>
          <p className="mt-1 text-xs text-ch-muted">Resale agents you manage</p>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-ch-line flex items-center gap-2">
          <Trophy className="w-4 h-4" style={{ color: 'var(--pms-accent)' }} />
          <h2 className="font-semibold text-ch-pine">Leaderboard</h2>
        </div>
        {!leaderboard.length ? (
          <EmptyState
            title="No resale agents yet"
            subtitle="Assign resale agents to this manager in User Management."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ch-muted border-b border-ch-line">
                  <th className="px-5 py-2.5 font-semibold">Rank</th>
                  <th className="px-3 py-2.5 font-semibold">Agent</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Units today</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Units</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Sales today</th>
                  <th className="px-5 py-2.5 font-semibold text-right">Sales</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((row, idx) => (
                  <tr key={row.staff_id} className="border-b border-ch-line/70 last:border-0">
                    <td className="px-5 py-3 font-semibold text-ch-pine">{medal(idx + 1)}</td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-ch-pine">{row.full_name}</div>
                      <div className="text-[11px] text-ch-muted">
                        {ROLE_LABELS[row.role] || row.role}
                  </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.units_today}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">{row.units_total}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.sales_today}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold">
                      {row.sales_total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DailyBars
          rows={dailyUnits}
          title="Units added daily"
          subtitle="Sale units created each day"
          emptyTitle="No unit activity in range"
        />
        <DailyBars
          rows={dailySales}
          title="Sales signed daily"
          subtitle="Owner requests marked signed each day"
          emptyTitle="No signed sales in range"
        />
      </div>
    </div>
  );
}

export default function Performance() {
  const { user } = useAuth();
  if (isResaleManager(user)) return <ResalePerformance />;
  return <ReservationsPerformance />;
}
