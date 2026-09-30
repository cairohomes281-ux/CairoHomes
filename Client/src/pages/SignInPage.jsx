import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { defaultAdminPage, ADMIN_CHANGE_PASSWORD } from '../admin/utils/adminRoutes';
import AuthShell, { AuthError, AuthField, AuthSubmit } from '../components/auth/AuthShell';
import { LogoMark } from '../components/brand/Logo';
import { CAIRO_IMAGES } from '../data/compounds';

export default function SignInPage() {
  const { t } = useLocale();
  const { signIn, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const staffOnly = params.get('staff') === '1';
  const nextPath = params.get('next') || '/account';
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!staffOnly && user) {
      navigate(nextPath.startsWith('/') ? nextPath : '/account', { replace: true });
      return;
    }
    try {
      const staff = JSON.parse(localStorage.getItem('pms_user') || 'null');
      if (staff && localStorage.getItem('pms_token')) {
        if (staff.is_first_login) {
          navigate(ADMIN_CHANGE_PASSWORD, { replace: true });
        } else {
          navigate(defaultAdminPage(staff), { replace: true });
        }
      }
    } catch {}
  }, [user, navigate, nextPath, staffOnly]);

  return (
    <AuthShell
      imageSrc={CAIRO_IMAGES.livingRoom}
      eyebrow={staffOnly ? t('auth.staffAccess') : t('auth.letsGetStarted')}
      title={staffOnly ? t('auth.staffPmsTitle') : t('auth.panelTitle')}
      imageAlt="Cairo Homes living room"
    >
      <div className="mb-8 text-center">
        <LogoMark className="mx-auto mb-5 hidden h-16 w-auto text-ch-pine md:block" />
        <h1 className="font-display text-3xl text-ch-pine-dark sm:text-[2.6rem]">
          {staffOnly ? t('auth.staffSignInTitle') : t('auth.welcomeBack')}
        </h1>
        <p className="mt-2 text-sm text-ch-muted">
          {staffOnly
            ? t('auth.teamMembersOnly')
            : t('auth.signInSubtitle')}
        </p>
      </div>

      <form
        className="space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          setLoading(true);
          try {
            const result = await signIn(identity, password, { staffOnly });
            if (result.kind === 'staff') {
              if (result.forcePasswordChange || result.user?.is_first_login) {
                navigate(ADMIN_CHANGE_PASSWORD, { replace: true });
              } else {
                navigate(defaultAdminPage(result.user), { replace: true });
              }
            } else if (!staffOnly) {
              navigate(nextPath.startsWith('/') ? nextPath : '/account', { replace: true });
            } else {
              setError(t('auth.staffCredentialsRequired'));
            }
          } catch (err) {
            setError(
              staffOnly
                ? err.response?.data?.error || err.message || t('auth.invalidStaffCreds')
                : err.response?.data?.error || err.message || t('auth.signInFailed')
            );
          } finally {
            setLoading(false);
          }
        }}
      >
        <AuthField
          label={staffOnly ? t('auth.username') : t('auth.identity')}
          icon={User}
          name="identity"
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          placeholder={staffOnly ? t('auth.staffUsernamePh') : t('auth.identityPh')}
          autoComplete="username"
        />

        <AuthField
          label={t('auth.password')}
          icon={Lock}
          name="password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.passwordPh')}
          autoComplete="current-password"
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

        <AuthError message={error} />
        <AuthSubmit loading={loading} loadingLabel={t('auth.signingIn')}>
          {staffOnly ? t('auth.signInToPms') : t('auth.signIn')}
        </AuthSubmit>
      </form>

      {!staffOnly && (
        <>
          <p className="mt-4 text-center text-sm">
            <Link to="/forgot-password" className="font-medium text-ch-muted hover:text-ch-pine">
              {t('auth.forgot')}
            </Link>
          </p>

          <p className="mt-6 text-center text-sm text-ch-muted">
            {t('auth.noAccount')}{' '}
            <Link
              to="/sign-up"
              className="font-semibold text-ch-pine transition-colors hover:text-ch-pine-dark"
            >
              {t('auth.signUpNow')}
            </Link>
          </p>
        </>
      )}

      {staffOnly && (
        <p className="mt-6 text-center text-sm text-ch-muted">
          <Link to="/" className="font-medium text-ch-muted hover:text-ch-pine">
            â† {t('auth.backToHome')}
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
