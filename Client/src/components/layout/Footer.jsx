import { Link } from 'react-router-dom';
import { ArrowUpRight, Mail, MapPin, Phone } from 'lucide-react';
import { brand, whatsappHref } from '../../theme/brand';
import { useLocale } from '../../context/LocaleContext';
const FacebookIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M13.5 22v-8.2h2.75l.42-3.2H13.5V8.55c0-.93.26-1.56 1.63-1.56h1.74V4.13c-.3-.04-1.33-.13-2.53-.13-2.5 0-4.21 1.53-4.21 4.34v2.44H7.37v3.2h2.76V22h3.37Z" />
  </svg>
);

const InstagramIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" {...props}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4.2" />
    <circle cx="17.4" cy="6.6" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

const COLUMNS = [
  {
    titleKey: 'footer.stay',
    links: [
      { labelKey: 'nav.propertiesForRent', to: '/search' },
      { labelKey: 'nav.propertiesLongTerm', to: '/long-term' },
      { labelKey: 'nav.neighbourhoods', to: '/compounds' },
      { labelKey: 'nav.wishlist', to: '/wishlist' },
    ],
  },
  {
    titleKey: 'footer.company',
    links: [
      { labelKey: 'nav.about', to: '/about' },
      { labelKey: 'nav.becomeAHost', to: '/owners' },
      { labelKey: 'footer.workWithUs', to: '/careers' },
      { labelKey: 'footer.contact', to: '/contact' },
    ],
  },
  {
    titleKey: 'footer.support',
    links: [
      { labelKey: 'nav.faq', to: '/faq' },
      { labelKey: 'footer.terms', to: '/terms' },
      { labelKey: 'footer.privacy', to: '/privacy' },
      { labelKey: 'footer.refunds', to: '/refund-policy' },
    ],
  },
];

export default function Footer() {
  const { t } = useLocale();

  return (
    <footer className="ch-grain relative mt-20 overflow-hidden bg-ch-pine-dark text-ch-ivory sm:mt-28">
      <div className="ch-container relative pt-16 sm:pt-24">
        <div className="grid gap-10 border-b border-white/10 pb-14 lg:grid-cols-[1.2fr_1fr] lg:gap-20">
          <div>
            <p className="ch-eyebrow text-ch-blush/80">{t('footer.eyebrow')}</p>
            <h2 className="mt-5 max-w-xl font-display text-[2.4rem] leading-[1.05] text-ch-ivory md:text-[3.6rem]">
              {t('footer.headline')} <em className="font-light italic text-ch-blush">{t('footer.headlineEm')}</em>
            </h2>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={whatsappHref()} target="_blank" rel="noreferrer" className="ch-btn-blush">
                {t('nav.whatsappUs')}
                <ArrowUpRight size={16} className="rtl:-scale-x-100" />
              </a>
              <Link to="/search" className="ch-btn-outline !border-white/30 !text-ch-ivory hover:!bg-white hover:!text-ch-pine-dark">
                {t('home.searchStays')}
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.titleKey}>
                <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-ch-blush/70">{t(col.titleKey)}</p>
                <ul className="space-y-3">
                  {col.links.map((l) => (
                    <li key={l.to}>
                      <Link to={l.to} className="ch-underline-draw text-[14px] text-ch-ivory/75 transition-colors hover:text-ch-ivory">
                        {t(l.labelKey)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-6 py-10 text-[14px] text-ch-ivory/70 sm:grid-cols-2 lg:grid-cols-4">
          <a href={brand.mapsUrl || '#'} target="_blank" rel="noreferrer" className="flex items-start gap-3 hover:text-ch-ivory">
            <MapPin size={17} className="mt-0.5 shrink-0 text-ch-blush" />
            {brand.address}
          </a>
          <a href={`tel:${brand.phoneDisplay.replace(/\s/g, '')}`} className="flex items-center gap-3 hover:text-ch-ivory" dir="ltr">
            <Phone size={17} className="shrink-0 text-ch-blush" />
            {brand.phoneDisplay}
          </a>
          <a href={`mailto:${brand.email}`} className="flex items-center gap-3 hover:text-ch-ivory">
            <Mail size={17} className="shrink-0 text-ch-blush" />
            {brand.email}
          </a>
          <div className="flex items-center gap-3 lg:justify-end">
            <a
              href={brand.social.instagram}
              target="_blank"
              rel="noreferrer"
              aria-label={t('footer.instagram')}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/15 transition hover:border-ch-blush hover:bg-ch-blush hover:text-ch-pine-dark"
            >
              <InstagramIcon className="h-[18px] w-[18px]" />
            </a>
            <a
              href={brand.social.facebook}
              target="_blank"
              rel="noreferrer"
              aria-label={t('footer.facebook')}
              className="grid h-11 w-11 place-items-center rounded-full border border-white/15 transition hover:border-ch-blush hover:bg-ch-blush hover:text-ch-pine-dark"
            >
              <FacebookIcon className="h-[18px] w-[18px]" />
            </a>
          </div>
        </div>
      </div>

      <div className="relative select-none" aria-hidden="true">
        <div className="ch-container relative">
          <p
            className="whitespace-nowrap text-center font-brand uppercase leading-[0.8] text-ch-blush/[0.09]"
            style={{ fontSize: 'min(11.6vw, 10.4rem)' }}
          >
            Cairo Homes
          </p>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="ch-container flex flex-col gap-2 py-6 text-[11px] uppercase tracking-[0.2em] text-ch-ivory/45 sm:flex-row sm:items-center sm:justify-between">
          <span>{brand.copyright}</span>
          <span className="font-arabic-display normal-case tracking-normal">{brand.nameAr} — {t('footer.madeInCairo')}</span>
        </div>
      </div>
    </footer>
  );
}
