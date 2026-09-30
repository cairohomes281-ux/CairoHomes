import { useMemo, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { defaultAdminPage } from '../utils/adminRoutes';
import { getPasswordRuleChecks, passwordRuleItems } from '../utils/passwordRules';
import { getRoleTheme, roleThemeVars } from '../utils/roleTheme';
import { pmsLabel } from '../utils/permissions';
import PasswordChecklist from '../../components/auth/PasswordChecklist';

export default function ChangePassword() {
  const navigate = useNavigate();
  const { user, refreshUser, applySession } = useAuth();
  const theme = getRoleTheme(user?.role);
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [visibility, setVisibility] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [saving, setSaving] = useState(false);

  const checks = useMemo(
    () => getPasswordRuleChecks(form.newPassword, user?.email),
    [form.newPassword, user?.email]
  );
  const match = form.newPassword === form.confirmPassword;
  const canSubmit =
    Boolean(form.currentPassword) &&
    Object.values(checks).every(Boolean) &&
    match &&
    Boolean(form.confirmPassword);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await api.patch('/auth/change-password', {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      if (res.data?.token) applySession(res.data.token, res.data.user);
      await refreshUser();
      toast.success('Password updated');
      navigate(defaultAdminPage(user), { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Unable to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main
      className="pms-shell min-h-screen px-4 py-8 sm:py-12"
      data-pms-role={user?.role || 'admin'}
      style={roleThemeVars(user?.role)}
    >
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-[28px] border border-ch-line bg-white/95 shadow-[0_24px_80px_rgba(47,93,88,0.12)] lg:grid-cols-[0.9fr_1.1fr]">
          <div
            className="hidden p-10 text-white lg:flex lg:flex-col lg:justify-between"
            style={{
              background: `linear-gradient(160deg, ${theme.sidebarFrom}, ${theme.sidebarVia} 50%, ${theme.sidebarTo})`,
            }}
          >
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/55">
                {theme.eyebrow}
              </p>
              <h1 className="mt-4 font-display text-3xl leading-tight tracking-wide">
                Set a new password before using the PMS.
              </h1>
              <p className="mt-3 text-sm text-white/75">
                Your temporary password must be changed before you can use the PMS.
              </p>
              <p className="mt-4 text-xs uppercase tracking-[0.2em] text-white/45">
                {pmsLabel(user) || 'Cairo Homes PMS'}
              </p>
            </div>
            <div
              className="rounded-2xl border border-white/15 bg-white/10 p-4"
              style={{ boxShadow: `0 0 0 1px ${theme.accent}33` }}
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4" style={{ color: theme.accent }} /> Password policy
              </div>
              <ul className="mt-2 space-y-1 text-xs text-white/80">
                {passwordRuleItems.map((r) => (
                  <li key={r.key}>â€¢ {r.label}</li>
                ))}
              </ul>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 p-8 sm:p-10">
            <div className="flex items-center gap-2 text-ch-pine">
              <LockKeyhole className="h-5 w-5" style={{ color: 'var(--pms-accent)' }} />
              <h2 className="font-display text-2xl">Change password</h2>
            </div>
            {user?.staff_code && (
              <p className="text-sm text-ch-muted">
                Staff ID{' '}
                <span className="font-mono font-semibold text-ch-pine">{user.staff_code}</span>
              </p>
            )}

            {['currentPassword', 'newPassword', 'confirmPassword'].map((field) => (
              <label key={field} className="block space-y-1.5 text-sm font-medium text-ch-muted">
                {field === 'currentPassword' && 'Current password'}
                {field === 'newPassword' && 'New password'}
                {field === 'confirmPassword' && 'Confirm new password'}
                <div className="relative">
                  <input
                    type={visibility[field] ? 'text' : 'password'}
                    className="input pr-10"
                    value={form[field]}
                    onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                    required
                    autoComplete={field === 'currentPassword' ? 'current-password' : 'new-password'}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ch-muted"
                    onClick={() => setVisibility((v) => ({ ...v, [field]: !v[field] }))}
                  >
                    {visibility[field] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
            ))}

            <div className="space-y-3">
              <PasswordChecklist checks={checks} />
              <div
                className={`flex items-center gap-2 text-xs ${
                  match && form.confirmPassword ? 'text-emerald-700' : 'text-ch-muted'
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                    match && form.confirmPassword
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-ch-line bg-white'
                  }`}
                >
                  {match && form.confirmPassword ? 'âœ“' : 'Ã—'}
                </span>
                Passwords match
              </div>
            </div>

            <button type="submit" disabled={!canSubmit || saving} className="btn-primary w-full justify-center">
              {saving ? 'Savingâ€¦' : 'Save new password'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
