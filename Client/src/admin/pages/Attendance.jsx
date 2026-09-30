import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { ROLE_LABELS, hasOfficeAttendance } from '../utils/permissions';
import { currency } from '../utils/formatters';
import { computeAttendanceAmount, LEAVE_TYPE_LABELS } from '../utils/hrPolicy';

const CELL_W = 36;
const STATUS_META = {
  on_time: { label: 'On time', className: 'bg-emerald-500 hover:bg-emerald-600' },
  late: { label: 'Late', className: 'bg-amber-400 hover:bg-amber-500' },
  no_show: { label: 'No show', className: 'bg-red-500 hover:bg-red-600' },
  holiday: { label: 'Holiday', className: 'bg-blue-500 hover:bg-blue-600' },
};

const HOLIDAY_TYPE_OPTIONS = [
  { value: 'casual', label: LEAVE_TYPE_LABELS.casual },
  { value: 'annual', label: LEAVE_TYPE_LABELS.annual },
  { value: 'unpaid', label: LEAVE_TYPE_LABELS.unpaid },
  { value: 'sick', label: LEAVE_TYPE_LABELS.sick },
];

function normalizeHolidayType(type) {
  const t = String(type || '');
  if (t === 'holiday') return 'annual';
  if (t === 'day_off') return 'casual';
  return HOLIDAY_TYPE_OPTIONS.some((o) => o.value === t) ? t : 'unpaid';
}

function currentMonthIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym) {
  const [y, m] = String(ym || '').split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

function shiftMonth(ym, delta) {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short' });
}

function cellKey(staffId, date) {
  return `${staffId}|${date}`;
}

function emptyForm(staff, date, cell) {
  return {
    staff_user_id: staff?.id || '',
    staff_name: staff?.full_name || '',
    work_date: date || '',
    status: cell?.status || 'on_time',
    leave_type: normalizeHolidayType(cell?.leave_type),
    leave_request_id: cell?.leave_request_id || null,
    start_date: cell?.start_date || date || '',
    end_date: cell?.end_date || date || '',
    check_in: String(cell?.check_in || '').slice(0, 5),
    check_out: String(cell?.check_out || '').slice(0, 5),
    deduction_amount: cell ? String(cell.deduction_amount ?? 0) : '',
  };
}

export default function Attendance() {
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [month, setMonth] = useState(currentMonthIso);
  const [form, setForm] = useState(null);
  const [deductionTouched, setDeductionTouched] = useState(false);
  const [tip, setTip] = useState(null);

  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));

  const { data, isLoading } = useQuery({
    queryKey: ['hr-attendance', year, monthNum],
    queryFn: () =>
      api.get('/hr/attendance', { params: { year, month: monthNum } }).then((r) => r.data),
  });

  const days = data?.days || [];
  const staff = (data?.staff || []).filter((s) => hasOfficeAttendance(s.role, s));
  const cells = data?.cells || {};
  const today = currentMonthIso() === month
    ? `${year}-${String(monthNum).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`
    : '';

  const saveMutation = useMutation({
    mutationFn: (payload) => api.put('/hr/attendance', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-attendance'] });
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      qc.invalidateQueries({ queryKey: ['hr-leave-requests'] });
      qc.invalidateQueries({ queryKey: ['hr-staff'] });
      toast.success('Attendance saved');
      setForm(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save attendance'),
  });

  const importMutation = useMutation({
    mutationFn: (file) => {
      const name = String(file?.name || '');
      if (!/\.xlsx?$/i.test(name)) {
        return Promise.reject({
          response: { data: { error: 'Upload an Excel Original Records Report (.xls or .xlsx) only' } },
        });
      }
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/hr/attendance/import', fd, { timeout: 180000 }).then((r) => r.data);
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['hr-attendance'] });
      qc.invalidateQueries({ queryKey: ['hr-deductions'] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      qc.invalidateQueries({ queryKey: ['hr-payslip'] });
      const dates = (Array.isArray(data?.deductions) ? data.deductions : [])
        .map((c) => String(c?.work_date || '').slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();
      if (dates[0]) setMonth(dates[0].slice(0, 7));
      const errCount = Array.isArray(data.errors) ? data.errors.length : 0;
      toast.success(
        `Imported ${data.created || 0} day${data.created === 1 ? '' : 's'} onto the schedule` +
          (data.skipped ? ` · skipped ${data.skipped}` : '') +
          (errCount ? ` · ${errCount} error${errCount === 1 ? '' : 's'}` : '')
      );
      if (errCount && data.errors[0]?.error) {
        toast.error(`Row ${data.errors[0].row}: ${data.errors[0].error}`);
      }
    },
    onError: (e) =>
      toast.error(
        e.code === 'ECONNABORTED'
          ? 'Import timed out — try a smaller date range'
          : e.response?.data?.error || 'Could not import attendance'
      ),
  });

  const selectedStaff = useMemo(
    () => staff.find((s) => String(s.id) === String(form?.staff_user_id)),
    [staff, form?.staff_user_id]
  );

  useEffect(() => {
    if (!form || deductionTouched || !selectedStaff || form.status === 'holiday') return;
    const amount = String(computeAttendanceAmount(selectedStaff.base_salary, form));
    if (String(form.deduction_amount) === amount) return;
    setForm((f) => (f ? { ...f, deduction_amount: amount } : f));
  }, [form?.status, form?.check_in, selectedStaff, deductionTouched]);

  function openCell(person, date) {
    const cell = cells[cellKey(person.id, date)];
    setTip(null);
    setDeductionTouched(false);
    setForm(emptyForm(person, date, cell));
  }

  function submitCell() {
    if (!form?.status) {
      toast.error('Choose a status');
      return;
    }
    if (form.status === 'holiday') {
      if (!form.leave_type) {
        toast.error('Choose a holiday type');
        return;
      }
      // Multi-day leave: only the holiday type can change from attendance.
      if (
        form.leave_request_id &&
        form.start_date &&
        form.end_date &&
        form.start_date !== form.end_date
      ) {
        api
          .patch(`/hr/leave-requests/${form.leave_request_id}/type`, {
            leave_type: form.leave_type,
          })
          .then(() => {
            qc.invalidateQueries({ queryKey: ['hr-attendance'] });
            qc.invalidateQueries({ queryKey: ['hr-deductions'] });
            qc.invalidateQueries({ queryKey: ['hr-payroll'] });
            qc.invalidateQueries({ queryKey: ['hr-leave-requests'] });
            qc.invalidateQueries({ queryKey: ['hr-staff'] });
            toast.success('Holiday type updated');
            setForm(null);
          })
          .catch((e) => toast.error(e.response?.data?.error || 'Could not update holiday type'));
        return;
      }
      saveMutation.mutate({
        staff_user_id: form.staff_user_id,
        work_date: form.work_date,
        status: 'holiday',
        leave_type: form.leave_type,
      });
      return;
    }
    if (form.status === 'late' && !String(form.check_in || '').trim()) {
      toast.error('Check-in time is required for a late day');
      return;
    }
    saveMutation.mutate({
      staff_user_id: form.staff_user_id,
      work_date: form.work_date,
      status: form.status,
      check_in: form.check_in,
      check_out: form.check_out,
      deduction_amount: form.deduction_amount === '' ? null : Number(form.deduction_amount),
    });
  }

  function clearCell() {
    saveMutation.mutate({
      staff_user_id: form.staff_user_id,
      work_date: form.work_date,
      clear: true,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ch-muted">HR</p>
          <h1 className="page-title mt-1">Attendance</h1>
          <p className="page-subtitle">
            Upload the Original Records Report Excel (.xls / .xlsx) with Person ID, Time, and
            Attendance Status. Person ID must match each person's Staff ID. Missing checkout
            defaults to 7:00 PM. Resale Manager and Unit Acquisition Manager are included; other
            line managers, admin, operations, and web developers are not.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={importMutation.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {importMutation.isPending ? 'Importing…' : 'Upload Excel'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) importMutation.mutate(file);
            }}
          />
          <button type="button" className="rounded-lg p-2 text-ch-muted hover:bg-slate-50" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <ChevronLeft className="w-5 h-5" />
          </button>
          <input
            type="month"
            className="input w-44"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentMonthIso())}
          />
          <button type="button" className="rounded-lg p-2 text-ch-muted hover:bg-slate-50" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-ch-muted">
        <span className="font-medium text-ch-pine">{monthLabel(month)}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-emerald-500" /> On time
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-amber-400" /> Late
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-red-500" /> No show
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-blue-500" /> Holiday
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-slate-200 bg-white" /> Empty
        </span>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-20 bg-white border-b border-r border-ch-line px-3 py-2 text-left min-w-[180px] shadow-[2px_0_0_#eef1f6]">
                    Staff
                  </th>
                  {days.map((date) => {
                    const isToday = date === today;
                    const dow = weekday(date);
                    const weekend = dow === 'Sat' || dow === 'Sun';
                    return (
                      <th
                        key={date}
                        style={{ minWidth: CELL_W, width: CELL_W }}
                        className={`sticky top-0 z-10 border-b border-r border-slate-100 px-0 py-1 text-center ${
                          isToday ? 'bg-ch-pine text-white' : weekend ? 'bg-amber-50 text-amber-800' : 'bg-white text-ch-muted'
                        }`}
                      >
                        <div className="text-[10px] font-bold">{Number(date.slice(8))}</div>
                        <div className="text-[8px] uppercase opacity-70">{dow}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {staff.map((person) => (
                  <tr key={person.id} className="hover:bg-slate-50/60">
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-ch-line px-3 py-1 min-w-[180px]">
                      <div className="font-semibold text-ch-pine truncate">{person.full_name}</div>
                      <div className="text-[10px] text-ch-muted truncate">
                        ID {person.id}
                        {ROLE_LABELS[person.role] ? ` · ${ROLE_LABELS[person.role]}` : person.role ? ` · ${person.role}` : ''}
                        {person.staff_code ? ` · ${person.staff_code}` : ''}
                      </div>
                    </td>
                    {days.map((date) => {
                      const cell = cells[cellKey(person.id, date)];
                      const meta = cell ? STATUS_META[cell.status] : null;
                      return (
                        <td key={date} className="border-b border-r border-slate-100 p-0.5" style={{ width: CELL_W }}>
                          <button
                            type="button"
                            className={`block h-7 w-full rounded-sm ${
                              meta ? meta.className : 'bg-slate-100 hover:bg-slate-200'
                            }`}
                            onClick={() => openCell(person, date)}
                            onMouseEnter={(e) => {
                              const box = e.currentTarget.getBoundingClientRect();
                              setTip({
                                x: box.left + box.width / 2,
                                y: box.bottom + 8,
                                person,
                                date,
                                cell,
                              });
                            }}
                            onMouseLeave={() => setTip(null)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tip ? (
        <div
          className="fixed z-[80] w-56 -translate-x-1/2 rounded-xl border border-ch-line bg-white p-3 text-xs shadow-xl pointer-events-none"
          style={{ left: tip.x, top: tip.y }}
        >
          <div className="font-semibold text-ch-pine">{tip.person.full_name}</div>
          <div className="text-ch-muted">{tip.date}</div>
          {tip.cell ? (
            <div className="mt-2 space-y-1 text-ch-pine">
              <div>
                Status:{' '}
                <span className="font-medium">{STATUS_META[tip.cell.status]?.label || tip.cell.status}</span>
              </div>
              {tip.cell.status === 'holiday' ? (
                <>
                  <div>
                    {LEAVE_TYPE_LABELS[tip.cell.leave_type] || tip.cell.leave_type || 'Approved holiday'}
                    {tip.cell.start_date && tip.cell.end_date && tip.cell.start_date !== tip.cell.end_date
                      ? ` · ${tip.cell.start_date} → ${tip.cell.end_date}`
                      : ''}
                  </div>
                  <div>Deduction: {currency(tip.cell.deduction_amount || 0)}</div>
                  <div className="text-ch-muted">Click to edit status or holiday type</div>
                </>
              ) : (
                <>
                  <div>Check-in: {tip.cell.check_in || '—'}</div>
                  <div>Check-out: {tip.cell.check_out || '—'}</div>
                  <div>Deduction: {currency(tip.cell.deduction_amount || 0)}</div>
                </>
              )}
            </div>
          ) : (
            <div className="mt-2 text-ch-muted">No attendance recorded. Click to edit.</div>
          )}
        </div>
      ) : null}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form ? `${form.staff_name} · ${form.work_date}` : 'Attendance'}
        footer={
          <>
            {cells[cellKey(form?.staff_user_id, form?.work_date)] ? (
              <button type="button" className="btn-secondary mr-auto" onClick={clearCell} disabled={saveMutation.isPending}>
                Clear
              </button>
            ) : null}
            <button type="button" className="btn-secondary" onClick={() => setForm(null)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submitCell} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {form ? (
          <div className="space-y-4">
            <div>
              <label className="label">Status</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(STATUS_META).map(([value, meta]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setDeductionTouched(false);
                      setForm((f) => ({
                        ...f,
                        status: value,
                        leave_type: value === 'holiday' ? f.leave_type || 'casual' : f.leave_type,
                      }));
                    }}
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                      form.status === value ? 'border-ch-pine ring-2 ring-ch-pine/20' : 'border-ch-line'
                    }`}
                  >
                    <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-sm ${meta.className.split(' ')[0]}`} />
                    {meta.label}
                  </button>
                ))}
              </div>
            </div>

            {form.status === 'holiday' ? (
              <div>
                <label className="label">Holiday type</label>
                <div className="grid grid-cols-2 gap-2">
                  {HOLIDAY_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm((f) => (f ? { ...f, leave_type: opt.value } : f))}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold ${
                        form.leave_type === opt.value
                          ? 'border-ch-pine ring-2 ring-ch-pine/20'
                          : 'border-ch-line'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {form.start_date && form.end_date && form.start_date !== form.end_date ? (
                  <p className="mt-2 text-xs text-amber-700">
                    This day is part of a multi-day holiday ({form.start_date} → {form.end_date}).
                    You can change the holiday type for the whole request, or clear only after cancelling
                    that leave.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-ch-muted">
                    Marks this day as an approved holiday and removes check-in / late / no-show for the day.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Check-in</label>
                    <input
                      type="time"
                      className="input"
                      value={form.check_in}
                      onChange={(e) => {
                        setDeductionTouched(false);
                        setForm((f) => ({ ...f, check_in: e.target.value }));
                      }}
                    />
                  </div>
                  <div>
                    <label className="label">Check-out</label>
                    <input
                      type="time"
                      className="input"
                      value={form.check_out}
                      onChange={(e) => setForm((f) => ({ ...f, check_out: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Deduction</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="input"
                    value={form.deduction_amount}
                    onChange={(e) => {
                      setDeductionTouched(true);
                      setForm((f) => ({ ...f, deduction_amount: e.target.value }));
                    }}
                  />
                </div>
              </>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
