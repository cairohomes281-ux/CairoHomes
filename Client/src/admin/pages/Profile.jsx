import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, CheckCircle, Palmtree, Banknote, Home } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { roleLabel, pmsLabel, ROLE_COLORS, canRequestLoan, canRequestStaffBenefits, canRequestWfh } from '../utils/permissions';
import { getRoleTheme } from '../utils/roleTheme';
import { formatDate, formatDateTime } from '../utils/formatters';
import { getPasswordRuleChecks, passwordPolicyMessage } from '../utils/passwordRules';
import PasswordChecklist from '../../components/auth/PasswordChecklist';
import {
  LEAVE_TYPE_LABELS,
  requestableLeaveTypes,
  formatUnpaidLeaveAvailable,
  isExcuseLeaveType,
  isMissionLeaveType,
  isTimedLeaveType,
} from '../utils/hrPolicy';

export default function Profile() {
  const { user, refreshUser, applySession } = useAuth();
  const qc = useQueryClient();
  const theme = getRoleTheme(user?.role);
  const [pwForm, setPwForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [showPw, setShowPw] = useState(false);

  const checks = useMemo(
    () => getPasswordRuleChecks(pwForm.new_password, user?.email),
    [pwForm.new_password, user?.email]
  );
  const match = pwForm.new_password === pwForm.confirm_password;
  const canSubmit =
    Boolean(pwForm.current_password) &&
    Object.values(checks).every(Boolean) &&
    match &&
    Boolean(pwForm.confirm_password);

  const canRequestLeave = canRequestStaffBenefits(user);
  const canAskLoan = canRequestLoan(user);
  const showWfhRequest = canRequestWfh(user);
  const [leaveForm, setLeaveForm] = useState({
    leave_type: 'casual',
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    reason: '',
  });
  const [loanForm, setLoanForm] = useState({ amount: '', reason: '' });
  const [wfhForm, setWfhForm] = useState({ work_date: '', reason: '' });

  const { data: myLeave = [] } = useQuery({
    queryKey: ['hr-leave-requests', 'mine'],
    queryFn: () => api.get('/hr/leave-requests', { params: { mine: 1 } }).then((r) => r.data),
    enabled: canRequestLeave,
  });
  const { data: leaveSnap } = useQuery({
    queryKey: ['hr-my-leave'],
    queryFn: () => api.get('/hr/my-leave').then((r) => r.data),
    enabled: canRequestLeave,
  });

  const leaveMutation = useMutation({
    mutationFn: (payload) => api.post('/hr/leave-requests', payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['hr-leave-requests'] });
      qc.invalidateQueries({ queryKey: ['hr-my-leave'] });
      toast.success(
        isMissionLeaveType(vars?.leave_type)
          ? 'Mission request sent'
          : isExcuseLeaveType(vars?.leave_type)
            ? 'Excuse request sent'
            : 'Holiday request sent'
      );
      setLeaveForm({
        leave_type: leaveSnap?.can_request_holidays === false ? 'paid_excuse' : 'casual',
        start_date: '',
        end_date: '',
        start_time: '',
        end_time: '',
        reason: '',
      });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not submit request'),
  });

  const loanMutation = useMutation({
    mutationFn: (payload) => api.post('/hr/loans', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-loans'] });
      toast.success('Loan request sent');
      setLoanForm({ amount: '', reason: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not submit loan'),
  });

  const wfhMutation = useMutation({
    mutationFn: (payload) => api.post('/hr/wfh', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-wfh'] });
      toast.success('Work-from-home request sent');
      setWfhForm({ work_date: '', reason: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not submit request'),
  });

  const submitLeave = () => {
    const leaveType =
      leaveSnap?.can_request_holidays === false &&
      !isTimedLeaveType(leaveForm.leave_type) &&
      leaveForm.leave_type !== 'unpaid'
        ? 'unpaid'
        : leaveForm.leave_type;
    if (!leaveForm.start_date) {
      toast.error('Choose a date');
      return;
    }
    if (isTimedLeaveType(leaveType)) {
      if (!leaveForm.start_time || !leaveForm.end_time) {
        toast.error('Choose start and end times');
        return;
      }
      if (isMissionLeaveType(leaveType) && !String(leaveForm.reason || '').trim()) {
        toast.error('A note is required for mission requests');
        return;
      }
      leaveMutation.mutate({
        ...leaveForm,
        leave_type: leaveType,
        end_date: leaveForm.start_date,
        reason: String(leaveForm.reason || '').trim(),
      });
      return;
    }
    if (!leaveForm.end_date) {
      toast.error('Choose start and end dates');
      return;
    }
    if (leaveForm.end_date < leaveForm.start_date) {
      toast.error('End date must be on or after the start date');
      return;
    }
    leaveMutation.mutate({ ...leaveForm, leave_type: leaveType });
  };

  const changePwMutation = useMutation({
    mutationFn: (d) =>
      api.patch('/auth/change-password', {
        currentPassword: d.current_password,
        newPassword: d.new_password,
      }),
    onSuccess: async (res) => {
      if (res.data?.token) applySession(res.data.token, res.data.user);
      toast.success('Password changed successfully');
      setPwForm({ current_password: '', new_password: '', confirm_password: '' });
      if (refreshUser) await refreshUser();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error changing password'),
  });

  const handleChangePw = () => {
    if (!canSubmit) {
      if (!match) toast.error('New passwords do not match');
      else toast.error(passwordPolicyMessage());
      return;
    }
    changePwMutation.mutate(pwForm);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="page-header">
        <p className="ch-eyebrow mb-2" style={{ color: 'var(--pms-accent-text)' }}>
          {theme.eyebrow}
        </p>
        <h1 className="page-title">My Profile</h1>
        <p className="page-subtitle">Account settings · {pmsLabel(user)}</p>
      </div>

      <div className="card">
        <div className="flex items-center gap-5">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-3xl font-bold"
            style={{
              background: 'var(--pms-avatar)',
              boxShadow: '0 12px 28px var(--pms-nav-glow)',
            }}
          >
            {user?.full_name?.charAt(0)?.toUpperCase()}
          </div>
          <div>
            <h2 className="font-display text-2xl text-ch-pine">{user?.full_name}</h2>
            <p className="text-ch-muted text-sm">
              {user?.staff_code ? `${user.staff_code} · ` : ''}
              {user?.email || (user?.username ? `@${user.username}` : '—')}
            </p>
            <span className={`badge mt-2 ${ROLE_COLORS[user?.role]}`}>
              {roleLabel(user)}
            </span>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-ch-muted block">Email</span>
            <span className="text-ch-pine font-medium">{user?.email || '—'}</span>
          </div>
          <div>
            <span className="text-ch-muted block">Member Since</span>
            <span className="text-ch-pine font-medium">{formatDateTime(user?.created_at)}</span>
          </div>
          <div>
            <span className="text-ch-muted block">Account Status</span>
            <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
              <CheckCircle className="w-4 h-4" />
              Active
            </span>
          </div>
        </div>
      </div>

      {canRequestLeave && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Palmtree className="w-5 h-5 text-ch-muted" />
            <h3 className="font-semibold text-ch-pine">Time off</h3>
          </div>
          <p className="text-sm text-ch-muted mb-4">
            Casual and annual leave can be requested for any date (including past shifts). No salary deduction when approved.
            Unpaid leave deducts 1× daily rate; no show is 2× daily rate.
            Unpaid leave: unlimited (1× daily rate per approved day). Daily rate = base salary ÷ 30.
            Paid excuses: 2/month, max 2 hours each (manager or HR approval, no deduction).
            Unpaid excuses: unlimited, manager or HR approval, deducted hours × hourly rate (daily rate ÷ 24).
          </p>
          {leaveSnap && !leaveSnap.can_request_holidays ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-4">
              Paid holidays (casual, annual) open after 6 months, or when HR grants access.
              You can still request unpaid leave and excuses (manager or HR approval).
              {leaveSnap.tenure_months != null ? ` Current tenure: ${leaveSnap.tenure_months} months.` : ''}
            </p>
          ) : null}
          {leaveSnap && (
            <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="rounded-xl border border-ch-line px-2 py-2">
                <div className="text-[10px] uppercase text-ch-muted">Casual</div>
                <div className="font-semibold text-ch-pine">{leaveSnap.casual_available}</div>
              </div>
              <div className="rounded-xl border border-ch-line px-2 py-2">
                <div className="text-[10px] uppercase text-ch-muted">Annual</div>
                <div className="font-semibold text-ch-pine">{leaveSnap.annual_available}</div>
              </div>
              <div className="rounded-xl border border-ch-line px-2 py-2">
                <div className="text-[10px] uppercase text-ch-muted">Unpaid</div>
                <div className="font-semibold text-ch-pine">{formatUnpaidLeaveAvailable(leaveSnap)}</div>
              </div>
              <div className="rounded-xl border border-ch-line px-2 py-2">
                <div className="text-[10px] uppercase text-ch-muted">Paid excuses</div>
                <div className="font-semibold text-ch-pine">
                  {leaveSnap.paid_excuse_remaining ?? leaveSnap.early_leave_remaining}/
                  {leaveSnap.paid_excuse_max ?? leaveSnap.early_leave_max}
                </div>
              </div>
            </div>
          )}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={leaveForm.leave_type}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, leave_type: e.target.value }))}
                >
                  {requestableLeaveTypes(leaveSnap?.can_request_holidays !== false).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{isTimedLeaveType(leaveForm.leave_type) ? 'Day' : 'From'}</label>
                  <input
                    type="date"
                    className="input"
                    value={leaveForm.start_date}
                    onChange={(e) =>
                      setLeaveForm((f) => ({
                        ...f,
                        start_date: e.target.value,
                        end_date:
                          isTimedLeaveType(f.leave_type) || !f.end_date || f.end_date < e.target.value
                            ? e.target.value
                            : f.end_date,
                      }))
                    }
                  />
                </div>
                {!isTimedLeaveType(leaveForm.leave_type) && (
                <div>
                  <label className="label">To</label>
                  <input
                    type="date"
                    className="input"
                    value={leaveForm.end_date}
                    onChange={(e) => setLeaveForm((f) => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
                )}
                {isTimedLeaveType(leaveForm.leave_type) && (
                  <>
                    <div>
                      <label className="label">From time *</label>
                      <input
                        type="time"
                        className="input"
                        value={leaveForm.start_time}
                        onChange={(e) => setLeaveForm((f) => ({ ...f, start_time: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="label">To time *</label>
                      <input
                        type="time"
                        className="input"
                        value={leaveForm.end_time}
                        onChange={(e) => setLeaveForm((f) => ({ ...f, end_time: e.target.value }))}
                      />
                      <p className="mt-1 text-[11px] text-slate-400">
                        {isMissionLeaveType(leaveForm.leave_type)
                          ? 'Paid mission time. Does not affect attendance. Needs manager or HR approval.'
                          : leaveForm.leave_type === 'paid_excuse'
                            ? 'Paid excuse: max 2 hours, 2 per month. Needs manager or HR approval.'
                            : 'Unpaid excuse: hours × (daily rate ÷ 24). Needs manager or HR approval.'}
                      </p>
                    </div>
                  </>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="label">
                  {isMissionLeaveType(leaveForm.leave_type) ? 'Note *' : 'Note'}
                </label>
                <textarea
                  className="input min-h-[72px]"
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder={
                    isMissionLeaveType(leaveForm.leave_type)
                      ? 'Describe the mission (required)'
                      : 'Optional'
                  }
                />
              </div>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={leaveMutation.isPending}
              onClick={submitLeave}
            >
              {leaveMutation.isPending ? 'Sending…' : 'Send request'}
            </button>
          </div>
          {Array.isArray(myLeave) && myLeave.length > 0 && (
            <div className="mt-5 border-t border-ch-line pt-4 space-y-2">
              {myLeave.slice(0, 8).map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium text-ch-pine">
                      {formatDate(r.start_date)}
                      {r.start_date !== r.end_date ? ` → ${formatDate(r.end_date)}` : ''}
                    </div>
                    <div className="text-xs text-ch-muted capitalize">
                      {LEAVE_TYPE_LABELS[r.leave_type] || String(r.leave_type || '').replace('_', ' ')}
                      {isTimedLeaveType(r.leave_type) && r.start_time
                        ? ` · ${String(r.start_time).slice(0, 5)}–${String(r.end_time || '').slice(0, 5)}`
                        : ''}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      r.status === 'approved'
                        ? 'bg-emerald-50 text-emerald-700'
                        : r.status === 'rejected'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-amber-50 text-amber-800'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {canAskLoan && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-ch-muted" />
            <h3 className="font-semibold text-ch-pine">Loan</h3>
          </div>
          <p className="text-sm text-ch-muted">If approved, the amount is deducted from next month’s salary.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Amount (EGP)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                value={loanForm.amount}
                onChange={(e) => setLoanForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Reason</label>
              <textarea
                className="input min-h-[64px]"
                value={loanForm.reason}
                onChange={(e) => setLoanForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={loanMutation.isPending}
            onClick={() => {
              if (!(Number(loanForm.amount) > 0)) return toast.error('Enter an amount');
              if (!loanForm.reason.trim()) return toast.error('Enter a reason');
              loanMutation.mutate({ amount: Number(loanForm.amount), reason: loanForm.reason.trim() });
            }}
          >
            {loanMutation.isPending ? 'Sending…' : 'Request loan'}
          </button>
        </div>
      )}

      {showWfhRequest && (
        <div className="card space-y-3">
          <div className="flex items-center gap-2">
            <Home className="w-5 h-5 text-ch-muted" />
            <h3 className="font-semibold text-ch-pine">Work from home</h3>
          </div>
          <p className="text-sm text-ch-muted">An approved WFH day counts as a half day on payroll.</p>
          <div>
            <label className="label">Date</label>
            <input
              type="date"
              className="input"
              value={wfhForm.work_date}
              onChange={(e) => setWfhForm((f) => ({ ...f, work_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Note</label>
            <textarea
              className="input min-h-[64px]"
              value={wfhForm.reason}
              onChange={(e) => setWfhForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={wfhMutation.isPending}
            onClick={() => {
              if (!wfhForm.work_date) return toast.error('Choose a date');
              wfhMutation.mutate({ work_date: wfhForm.work_date, reason: wfhForm.reason.trim() || undefined });
            }}
          >
            {wfhMutation.isPending ? 'Sending…' : 'Request WFH'}
          </button>
        </div>
      )}

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-5 h-5 text-ch-muted" />
          <h3 className="font-semibold text-ch-pine">Change Password</h3>
        </div>
        <div className="space-y-4">
          <div>
            <label className="label">Current Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              className="input"
              value={pwForm.current_password}
              onChange={(e) => setPwForm((f) => ({ ...f, current_password: e.target.value }))}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="label">New Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              className="input"
              value={pwForm.new_password}
              onChange={(e) => setPwForm((f) => ({ ...f, new_password: e.target.value }))}
              placeholder="Meet the policy below"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="label">Confirm New Password</label>
            <input
              type={showPw ? 'text' : 'password'}
              className="input"
              value={pwForm.confirm_password}
              onChange={(e) => setPwForm((f) => ({ ...f, confirm_password: e.target.value }))}
              autoComplete="new-password"
            />
          </div>

          <PasswordChecklist checks={checks} />
          <div
            className={`flex items-center gap-2 text-xs ${
              match && pwForm.confirm_password ? 'text-emerald-700' : 'text-ch-muted'
            }`}
          >
            <span>{match && pwForm.confirm_password ? '✓' : '×'}</span>
            Passwords match
          </div>

          <label className="flex items-center gap-2 text-sm text-ch-muted cursor-pointer">
            <input
              type="checkbox"
              checked={showPw}
              onChange={(e) => setShowPw(e.target.checked)}
              className="rounded"
            />
            Show passwords
          </label>
          <button
            type="button"
            onClick={handleChangePw}
            disabled={!canSubmit || changePwMutation.isPending}
            className="btn-primary"
          >
            {changePwMutation.isPending ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
  );
}
