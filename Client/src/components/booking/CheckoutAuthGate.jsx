import { useMemo, useState } from 'react';
import { Eye, EyeOff, Lock, Mail, Phone, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import PasswordChecklist from '../auth/PasswordChecklist';
import { getPasswordRuleChecks, passwordPolicyOk } from '../../utils/passwordRules';


export default function CheckoutAuthGate({ prefill = {} }) {
  const { signIn, signUp } = useAuth();
  const { t } = useLocale();
  const [mode, setMode] = useState('signin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [signInForm, setSignInForm] = useState({ email: prefill.email || '', password: '' });
  const [signUpForm, setSignUpForm] = useState({
    full_name: prefill.fullName || '',
    email: prefill.email || '',
    phone: prefill.phone || '',
    password: '',
    confirmPassword: '',
  });

  const checks = useMemo(
    () => getPasswordRuleChecks(signUpForm.password, signUpForm.email),
    [signUpForm.password, signUpForm.email]
  );
  const match = signUpForm.password === signUpForm.confirmPassword;
  const canSignUp =
    Boolean(signUpForm.email) &&
    Boolean(signUpForm.full_name) &&
    passwordPolicyOk(signUpForm.password, signUpForm.email) &&
    match &&
    Boolean(signUpForm.confirmPassword);

  async function handleSignIn(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn(signInForm.email, signInForm.password);
      if (result.kind !== 'guest') {
        setError(t('booking.staffError'));
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('booking.signInFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp(e) {
    e.preventDefault();
    setError('');
    if (signUpForm.password !== signUpForm.confirmPassword) {
      setError(t('common.passwordsDoNotMatch'));
      return;
    }
    if (!passwordPolicyOk(signUpForm.password, signUpForm.email)) {
      setError(t('common.passwordPolicy'));
      return;
    }
    setLoading(true);
    try {
      await signUp({
        email: signUpForm.email,
        password: signUpForm.password,
        full_name: signUpForm.full_name,
        phone: signUpForm.phone,
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message || t('booking.signUpFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-3xl border border-ch-line bg-white p-6 shadow-sm sm:p-8">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-ch-pine">{t('booking.authTitle')}</h2>
        <p className="mt-1 text-sm text-ch-muted">
          {t('booking.authBody')}
        </p>
      </div>

      <div className="mb-6 flex rounded-full border border-ch-line bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => {
            setMode('signin');
            setError('');
          }}
          className={`flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
            mode === 'signin'
              ? 'bg-ch-pine text-white shadow-sm'
              : 'text-ch-muted hover:text-ch-pine'
          }`}
        >
          {t('booking.authSignIn')}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('signup');
            setError('');
          }}
          className={`flex-1 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
            mode === 'signup'
              ? 'bg-ch-pine text-white shadow-sm'
              : 'text-ch-muted hover:text-ch-pine'
          }`}
        >
          {t('booking.authCreate')}
        </button>
      </div>

      {mode === 'signin' ? (
        <form className="space-y-4" onSubmit={handleSignIn}>
          <Field
            label={t('booking.email')}
            type="email"
            icon={Mail}
            value={signInForm.email}
            onChange={(v) => setSignInForm((f) => ({ ...f, email: v }))}
            placeholder={t('auth.emailPh')}
            autoComplete="email"
            required
          />
          <Field
            label={t('booking.password')}
            type={showPassword ? 'text' : 'password'}
            icon={Lock}
            value={signInForm.password}
            onChange={(v) => setSignInForm((f) => ({ ...f, password: v }))}
            placeholder={t('auth.passwordPh')}
            autoComplete="current-password"
            required
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-ch-muted hover:text-ch-pine"
                aria-label={showPassword ? t('common.hidePassword') : t('common.showPassword')}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || !signInForm.email || !signInForm.password}
            className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-ch-pine px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white hover:bg-ch-pine-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t('booking.signingIn') : t('booking.signInContinue')}
          </button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={handleSignUp}>
          <Field
            label={t('booking.fullName')}
            icon={User}
            value={signUpForm.full_name}
            onChange={(v) => setSignUpForm((f) => ({ ...f, full_name: v }))}
            placeholder={t('auth.fullNamePh')}
            autoComplete="name"
            required
          />
          <Field
            label={t('booking.email')}
            type="email"
            icon={Mail}
            value={signUpForm.email}
            onChange={(v) => setSignUpForm((f) => ({ ...f, email: v }))}
            placeholder={t('auth.emailPh')}
            autoComplete="email"
            required
          />
          <Field
            label={t('booking.phone')}
            icon={Phone}
            value={signUpForm.phone}
            onChange={(v) => setSignUpForm((f) => ({ ...f, phone: v }))}
            placeholder={t('booking.phonePh')}
            autoComplete="tel"
          />
          <Field
            label={t('booking.password')}
            type={showPassword ? 'text' : 'password'}
            icon={Lock}
            value={signUpForm.password}
            onChange={(v) => setSignUpForm((f) => ({ ...f, password: v }))}
            placeholder={t('auth.createPasswordPh')}
            autoComplete="new-password"
            required
            rightSlot={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-ch-muted hover:text-ch-pine"
                aria-label={showPassword ? t('common.hidePassword') : t('common.showPassword')}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
          <PasswordChecklist checks={checks} />
          <Field
            label={t('booking.confirmPassword')}
            type={showPassword ? 'text' : 'password'}
            icon={Lock}
            value={signUpForm.confirmPassword}
            onChange={(v) => setSignUpForm((f) => ({ ...f, confirmPassword: v }))}
            placeholder={t('auth.confirmPasswordPh')}
            autoComplete="new-password"
            required
          />
          {signUpForm.confirmPassword ? (
            <p className={`text-xs ${match ? 'text-emerald-700' : 'text-rose-600'}`}>
              {match ? t('common.passwordsMatch') : t('common.passwordsDoNotMatch')}
            </p>
          ) : null}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={loading || !canSignUp}
            className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-ch-pine px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white hover:bg-ch-pine-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? t('booking.creating') : t('booking.createContinue')}
          </button>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  value,
  onChange,
  type = 'text',
  placeholder,
  autoComplete,
  required,
  rightSlot,
}) {
  return (
    <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-ch-muted">
      {label}
      <div className="flex items-center gap-3 rounded-2xl border border-ch-line bg-white px-4 py-3 focus-within:border-ch-pine">
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-ch-muted" /> : null}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-sm font-normal normal-case tracking-normal text-ch-pine outline-none"
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
        />
        {rightSlot}
      </div>
    </label>
  );
}
