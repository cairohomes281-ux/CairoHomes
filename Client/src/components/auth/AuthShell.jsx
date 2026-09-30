import { Link } from 'react-router-dom';
import { X } from 'lucide-react';
import { brand } from '../../theme/brand';
import { useLocale } from '../../context/LocaleContext';
import { CAIRO_IMAGES } from '../../data/compounds';
import Logo from '../brand/Logo';

export default function AuthShell({
  children,
  imageSrc = CAIRO_IMAGES.livingRoom,
  eyebrow,
  title,
  imageAlt = 'Cairo Homes',
  variant = 'overlay',
}) {
  const { t } = useLocale();
  return (
    <main className="relative grid min-h-screen w-full grid-cols-1 bg-ch-ivory md:grid-cols-[1fr_1fr] lg:grid-cols-[1.05fr_0.95fr]">
      <Link
        to="/"
        aria-label={t('auth.closeGoHome')}
        className="fixed end-5 top-5 z-50 grid h-11 w-11 place-items-center rounded-full border border-ch-line bg-ch-ivory text-ch-pine transition duration-500 hover:border-ch-pine hover:bg-ch-pine hover:text-ch-ivory sm:end-6 sm:top-6"
      >
        <X className="h-5 w-5" strokeWidth={1.8} />
      </Link>

      <section className="ch-grain relative hidden h-screen w-full overflow-hidden bg-ch-pine-dark p-6 md:sticky md:top-0 md:flex md:flex-col lg:p-10">
        <Link to="/" className="relative z-10 mb-8">
          <Logo tone="light" markClassName="h-11 w-auto" />
        </Link>
        <div className="relative flex-1">
          <div aria-hidden="true" className="ch-sun-rise absolute end-[12%] top-[6%] h-32 w-32 rounded-full bg-ch-blush/90 lg:h-40 lg:w-40" />
          <div className="ch-arch absolute inset-x-[6%] bottom-0 top-[10%]">
            <img src={imageSrc} alt={imageAlt} className="ch-kenburns h-full w-full select-none object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-ch-ink/75 via-ch-ink/10 to-transparent" />
            <div className="absolute inset-x-8 bottom-10 text-ch-ivory lg:inset-x-12">
              <p className="ch-eyebrow text-ch-blush">{variant === 'badge' ? brand.name : eyebrow}</p>
              <h2 className="mt-3 font-display text-[2.2rem] font-light leading-[1.05] lg:text-[3rem]">{title}</h2>
              <p className="mt-4 max-w-sm text-[14px] text-ch-ivory/70">{brand.tagline}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative flex min-h-screen w-full flex-col justify-center px-6 py-16 sm:px-14 lg:px-24">
        <div className="ch-fade-up mx-auto w-full max-w-md" style={{ animationDuration: '0.8s' }}>
          <Link to="/" className="mb-10 flex justify-center md:hidden">
            <Logo markClassName="h-10 w-auto" />
          </Link>
          {children}
        </div>
      </section>
    </main>
  );
}

export function AuthField({
  label,
  icon: Icon,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoComplete,
  required = true,
  rightSlot,
  name,
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ch-clay">{label}</span>
      <div className="relative">
        {Icon ? (
          <span className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-ch-muted/70">
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
        ) : null}
        <input
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          className={`w-full rounded-full border border-ch-line bg-white py-3.5 text-sm text-ch-pine outline-none transition-all placeholder:text-ch-muted/45 focus:border-ch-pine/50 focus:ring-4 focus:ring-ch-blush/40 ${
            Icon ? 'ps-12' : 'ps-5'
          } ${rightSlot ? 'pe-12' : 'pe-5'}`}
        />
        {rightSlot ? <div className="absolute end-4 top-1/2 -translate-y-1/2">{rightSlot}</div> : null}
      </div>
    </label>
  );
}

export function AuthError({ message }) {
  if (!message) return null;
  return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>;
}

export function AuthSubmit({ loading, children, loadingLabel, disabled }) {
  const { t } = useLocale();
  return (
    <button type="submit" disabled={loading || disabled} className="ch-btn mt-2 w-full">
      {loading ? loadingLabel || t('auth.pleaseWait') : children}
    </button>
  );
}
