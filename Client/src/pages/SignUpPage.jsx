import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, Phone, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import AuthShell, { AuthError, AuthField, AuthSubmit } from '../components/auth/AuthShell';
import { CAIRO_IMAGES } from '../data/compounds';
import PasswordChecklist from '../components/auth/PasswordChecklist';
import { getPasswordRuleChecks, passwordPolicyOk } from '../utils/passwordRules';

export default function SignUpPage() {
  const { t } = useLocale();
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const checks = useMemo(
    () => getPasswordRuleChecks(form.password, form.email),
    [form.password, form.email]
  );
  const match = form.password === form.confirmPassword;
  const canSubmit =
    Boolean(form.email) &&
    Boolean(form.full_name) &&
    passwordPolicyOk(form.password, form.email) &&
    match &&
    Boolean(form.confirmPassword);

  return (
    <AuthShell
      variant="badge"
      imageSrc={CAIRO_IMAGES.suite}
      title={t('auth.createTitle')}
      imageAlt="Cairo Homes living space"
    >
      <div className="mb-8">
        <p className="ch-eyebrow text-ch-muted">{t('auth.joinUs')}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ch-pine sm:text-4xl">
          {t('auth.createTitle')}
        </h1>
        <p className="mt-2 text-sm text-ch-muted">
          {t('auth.createSubtitle')}
        </p>
      </div>

      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          if (form.password !== form.confirmPassword) {
            setError(t('common.passwordsDoNotMatch'));
            return;
          }
          if (!passwordPolicyOk(form.password, form.email)) {
            setError(t('common.passwordPolicy'));
            return;
          }
          setLoading(true);
          try {
            await signUp({
              email: form.email,
              password: form.password,
              full_name: form.full_name,
              phone: form.phone,
            });
            navigate('/account', { replace: true });
          } catch (err) {
            setError(err.response?.data?.error || err.message || t('auth.signUpFailed'));
          } finally {
            setLoading(false);
          }
        }}
      >
        <AuthField
          label={t('auth.fullName')}
          icon={User}
          name="full_name"
          value={form.full_name}
          onChange={setField('full_name')}
          placeholder={t('auth.fullNamePh')}
          autoComplete="name"
        />
        <AuthField
          label={t('auth.email')}
          icon={Mail}
          name="email"
          type="email"
          value={form.email}
          onChange={setField('email')}
          placeholder={t('auth.emailPh')}
          autoComplete="email"
        />
        <AuthField
          label={t('auth.phone')}
          icon={Phone}
          name="phone"
          type="tel"
          value={form.phone}
          onChange={setField('phone')}
          placeholder={t('auth.phonePh')}
          autoComplete="tel"
          required={false}
        />
        <AuthField
          label={t('auth.password')}
          icon={Lock}
          name="password"
          type={showPassword ? 'text' : 'password'}
          value={form.password}
          onChange={setField('password')}
          placeholder={t('auth.createPasswordPh')}
          autoComplete="new-password"
          rightSlot={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="text-ch-muted transition-colors hover:text-ch-pine"
              aria-label={showPassword ? t('common.hidePassword') : t('common.showPassword')}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />
        <AuthField
          label={t('auth.confirmPassword')}
          icon={Lock}
          name="confirmPassword"
          type={showPassword ? 'text' : 'password'}
          value={form.confirmPassword}
          onChange={setField('confirmPassword')}
          placeholder={t('auth.confirmPasswordPh')}
          autoComplete="new-password"
        />

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
            {match && form.confirmPassword ? '✓' : '×'}
          </span>
          {t('common.passwordsMatch')}
        </div>

        <AuthError message={error} />
        <AuthSubmit loading={loading} loadingLabel={t('auth.creating')} disabled={!canSubmit}>
          {t('auth.signUp')}
        </AuthSubmit>
      </form>

      <p className="mt-8 text-center text-sm text-ch-muted">
        {t('auth.haveAccount')}{' '}
        <Link to="/sign-in" className="font-semibold text-ch-pine transition-colors hover:text-ch-pine-dark">
          {t('auth.signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
