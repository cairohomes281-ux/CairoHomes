import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useLocale } from '../context/LocaleContext';
import AuthShell from '../components/auth/AuthShell';
import { CAIRO_IMAGES } from '../data/compounds';

export default function StaffPasswordHelpPage() {
  const { t } = useLocale();

  return (
    <AuthShell
      imageSrc={CAIRO_IMAGES.reading}
      eyebrow={t('auth.accountRecovery')}
      title={t('auth.staffResetPanelTitle')}
      imageAlt="Cairo Homes apartment"
    >
      <div className="mb-8">
        <p className="ch-eyebrow text-ch-muted">{t('auth.staff')}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ch-pine sm:text-4xl">
          {t('auth.staffResetTitle')}
        </h1>
      </div>

      <div className="space-y-5">
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" strokeWidth={1.8} />
          <p className="leading-relaxed">{t('auth.staffResetBody')}</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            to="/sign-in?staff=1"
            className="inline-flex items-center justify-center rounded-full bg-ch-pine px-6 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white hover:bg-ch-pine-dark"
          >
            {t('auth.staffSignInCta')}
          </Link>
          <Link
            to="/sign-in"
            className="inline-flex items-center justify-center px-2 text-sm font-semibold text-ch-pine hover:text-ch-pine-dark"
          >
            {t('auth.backSignIn')}
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
