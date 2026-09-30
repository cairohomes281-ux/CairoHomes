import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Lock } from 'lucide-react';
import api from '../api/http';
import { useLocale } from '../context/LocaleContext';
import AuthShell, { AuthError, AuthField, AuthSubmit } from '../components/auth/AuthShell';
import { CAIRO_IMAGES } from '../data/compounds';
import PasswordChecklist from '../components/auth/PasswordChecklist';
import { getPasswordRuleChecks, passwordPolicyOk } from '../utils/passwordRules';

export default function ResetPasswordPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const checks = useMemo(() => getPasswordRuleChecks(password), [password]);
  const match = password === confirmPassword;
  const canSubmit =
    Boolean(token) && passwordPolicyOk(password) && match && Boolean(confirmPassword);

  return (
    <AuthShell
      imageSrc={CAIRO_IMAGES.bedroom}
      eyebrow={t('auth.accountRecovery')}
      title={t('auth.chooseNewPassword')}
      imageAlt="Cairo Homes living space"
    >
      <div className="mb-8">
        <p className="ch-eyebrow text-ch-muted">{t('auth.guests')}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ch-pine sm:text-4xl">
          {t('auth.resetTitle')}
        </h1>
        <p className="mt-2 text-sm text-ch-muted">
          {t('auth.resetSubtitle')}
        </p>
      </div>

      {!token ? (
        <div className="space-y-4">
          <AuthError message={t('auth.invalidLink')} />
          <Link
            to="/forgot-password"
            className="inline-flex font-semibold text-ch-pine hover:text-ch-pine-dark"
          >
            {t('auth.requestNew')}
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (!canSubmit) {
              setError(
                !match ? t('common.passwordsDoNotMatch') : t('common.passwordPolicy')
              );
              return;
            }
            setLoading(true);
            try {
              const { data } = await api.post('/auth/reset-password', {
                token,
                password,
              });
              if (data?.accessToken) {
                localStorage.setItem('ch_guest_token', data.accessToken);
                localStorage.setItem('ch_guest_user', JSON.stringify(data.user));
                window.location.assign('/account');
                return;
              }
              navigate('/sign-in', { replace: true });
            } catch (err) {
              setError(err.response?.data?.error || err.message || t('auth.unableReset'));
            } finally {
              setLoading(false);
            }
          }}
        >
          <AuthField
            label={t('auth.newPassword')}
            icon={Lock}
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.newPasswordPh')}
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
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('auth.confirmPasswordPh')}
            autoComplete="new-password"
          />
          <PasswordChecklist checks={checks} />
          <div
            className={`flex items-center gap-2 text-xs ${
              match && confirmPassword ? 'text-emerald-700' : 'text-ch-muted'
            }`}
          >
            <span>{match && confirmPassword ? '✓' : '×'}</span>
            {t('common.passwordsMatch')}
          </div>
          <AuthError message={error} />
          <AuthSubmit loading={loading} loadingLabel={t('auth.saving')} disabled={!canSubmit}>
            {t('auth.savePassword')}
          </AuthSubmit>
        </form>
      )}
    </AuthShell>
  );
}
