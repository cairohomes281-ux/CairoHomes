import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, Heart, Menu, User, X } from 'lucide-react';
import { brand, whatsappHref, listingWhatsAppMessage } from '../../theme/brand';
import { useCurrency } from '../../context/CurrencyContext';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../context/LocaleContext';
import Logo, { LogoMark } from '../brand/Logo';

const STAY_LINKS = [
  { labelKey: 'nav.propertiesForRent', descKey: 'nav.shortStaysDesc', to: '/search' },
  { labelKey: 'nav.propertiesLongTerm', descKey: 'nav.longTermDesc', to: '/long-term' },
];

const NAV_LINKS = [
  { labelKey: 'nav.neighbourhoods', to: '/compounds' },
  { labelKey: 'nav.becomeAHost', to: '/owners' },
  { labelKey: 'nav.about', to: '/about' },
];

const MOBILE_LINKS = [
  { labelKey: 'nav.propertiesForRent', to: '/search' },
  { labelKey: 'nav.propertiesLongTerm', to: '/long-term' },
  { labelKey: 'nav.neighbourhoods', to: '/compounds' },
  { labelKey: 'nav.becomeAHost', to: '/owners' },
  { labelKey: 'nav.about', to: '/about' },
  { labelKey: 'nav.faq', to: '/faq' },
  { labelKey: 'footer.contact', to: '/contact' },
];

function isStaysPath(pathname) {
  return pathname.startsWith('/search') || pathname.startsWith('/long-term') || pathname.startsWith('/listings');
}

function LanguageToggle({ className = '' }) {
  const { locale, toggleLocale, t } = useLocale();
  return (
    <button
      type="button"
      onClick={toggleLocale}
      className={`text-[12px] font-semibold tracking-[0.12em] transition ${className}`}
      aria-label={locale === 'en' ? t('nav.switchToAr') : t('nav.switchToEn')}
    >
      {locale === 'en' ? 'عربي' : 'EN'}
    </button>
  );
}

export default function Header({ overHero = false }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [staysOpen, setStaysOpen] = useState(false);
  const staysRef = useRef(null);
  const { currency, setCurrency } = useCurrency();
  const { user } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  useEffect(() => {
    setStaysOpen(false);
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!staysOpen) return undefined;
    const onPointer = (e) => {
      if (staysRef.current && !staysRef.current.contains(e.target)) setStaysOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setStaysOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [staysOpen]);

  const solid = !overHero || scrolled;
  const ink = solid ? 'text-ch-pine' : 'text-ch-ivory';
  const linkCls = `relative text-[12px] font-semibold uppercase tracking-[0.2em] transition-colors ${
    solid ? 'text-ch-pine/75 hover:text-ch-pine' : 'text-ch-ivory/80 hover:text-ch-ivory'
  }`;

  return (
    <>
      <header
        className={`${overHero ? 'fixed' : 'sticky'} inset-x-0 top-0 z-50 transition-[background,box-shadow,height] duration-500 ease-ch ${
          solid ? 'ch-glass shadow-[0_10px_40px_-24px_rgba(16,33,31,0.35)]' : 'bg-gradient-to-b from-ch-ink/45 to-transparent'
        }`}
      >
        <div
          className={`ch-container grid grid-cols-[1fr_auto_1fr] items-center gap-4 transition-[height] duration-500 ease-ch ${
            solid ? 'h-[74px]' : 'h-[92px]'
          }`}
        >
          <nav className="hidden items-center gap-7 lg:flex">
            <div className="relative" ref={staysRef}>
              <button
                type="button"
                aria-expanded={staysOpen}
                aria-haspopup="menu"
                onClick={() => setStaysOpen((o) => !o)}
                className={`${linkCls} inline-flex items-center gap-1.5 ${isStaysPath(pathname) ? (solid ? '!text-ch-pine' : '!text-ch-ivory') : ''}`}
              >
                {t('nav.stays')}
                <ChevronDown size={13} strokeWidth={2.4} className={`transition-transform ${staysOpen ? 'rotate-180' : ''}`} />
              </button>
              {staysOpen && (
                <div
                  role="menu"
                  className="ch-fade-up absolute start-0 top-full z-50 mt-5 w-[320px] overflow-hidden rounded-[1.75rem] border border-ch-line bg-ch-ivory p-2 shadow-[0_30px_70px_-30px_rgba(16,33,31,0.45)]"
                  style={{ animationDuration: '0.45s' }}
                >
                  {STAY_LINKS.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      role="menuitem"
                      className="group flex items-start justify-between gap-4 rounded-[1.35rem] px-4 py-3.5 transition hover:bg-ch-rose/70"
                    >
                      <span>
                        <span className="block font-display text-[1.2rem] text-ch-pine-dark">{t(item.labelKey)}</span>
                        <span className="mt-0.5 block text-[12.5px] text-ch-muted">{t(item.descKey)}</span>
                      </span>
                      <ArrowUpRight size={18} className="mt-1 text-ch-clay transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
            {NAV_LINKS.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `${linkCls} ${isActive ? (solid ? '!text-ch-pine' : '!text-ch-ivory') : ''}`}>
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            className={`grid h-11 w-11 place-items-center rounded-full lg:hidden ${ink}`}
            onClick={() => setMobileOpen(true)}
            aria-label={t('nav.openMenu')}
          >
            <Menu size={22} strokeWidth={1.6} />
          </button>

          <Link to="/" className="justify-self-center" aria-label={brand.name}>
            <Logo
              tone={solid ? 'dark' : 'light'}
              markClassName={`w-auto transition-all duration-500 ${solid ? 'h-9' : 'h-11'}`}
              className="[&>span:last-child]:hidden sm:[&>span:last-child]:flex"
            />
          </Link>

          <div className={`flex items-center justify-end gap-1 sm:gap-2 ${ink}`}>
            <LanguageToggle className={`hidden rounded-full px-3 py-2 sm:inline-flex ${solid ? 'hover:bg-ch-rose/70' : 'hover:bg-white/10'}`} />
            <select
              aria-label={t('common.currency')}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`hidden cursor-pointer appearance-none rounded-full bg-transparent px-3 py-2 text-[12px] font-semibold tracking-[0.12em] outline-none md:block ${
                solid ? 'hover:bg-ch-rose/70' : 'hover:bg-white/10'
              }`}
            >
              <option value="EGP" className="text-ch-pine">EGP</option>
              <option value="USD" className="text-ch-pine">USD</option>
            </select>
            <Link
              to="/wishlist"
              className={`hidden h-10 w-10 place-items-center rounded-full md:grid ${solid ? 'hover:bg-ch-rose/70' : 'hover:bg-white/10'}`}
              aria-label={t('nav.wishlist')}
            >
              <Heart size={18} strokeWidth={1.6} />
            </Link>
            <button
              type="button"
              onClick={() => navigate(user ? '/account' : '/sign-in')}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.14em] transition sm:px-4 ${
                solid
                  ? 'border-ch-pine/20 hover:border-ch-pine hover:bg-ch-pine hover:text-ch-ivory'
                  : 'border-white/35 hover:bg-white hover:text-ch-pine-dark'
              }`}
            >
              <User size={15} strokeWidth={1.8} />
              <span className="hidden whitespace-nowrap sm:inline">{user ? t('nav.account') : t('nav.signIn')}</span>
            </button>
          </div>
        </div>
      </header>

      {mobileOpen && <MobileMenu onClose={() => setMobileOpen(false)} currency={currency} setCurrency={setCurrency} user={user} pathname={pathname} />}
    </>
  );
}

function MobileMenu({ onClose, currency, setCurrency, user, pathname }) {
  const { t, toggleLocale, locale } = useLocale();

  return (
    <div className="ch-menu-in ch-grain fixed inset-0 z-[70] flex flex-col bg-ch-pine-dark text-ch-ivory lg:hidden">
      <div className="ch-container flex h-[80px] items-center justify-between">
        <Logo tone="light" markClassName="h-10 w-auto" />
        <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-full border border-white/20" aria-label={t('nav.closeMenu')}>
          <X size={20} />
        </button>
      </div>

      <nav className="ch-container flex-1 overflow-y-auto py-6">
        <ol className="space-y-1">
          {MOBILE_LINKS.map((item, i) => (
            <li key={item.to} className="ch-fade-up" style={{ animationDelay: `${120 + i * 50}ms` }}>
              <Link
                to={item.to}
                onClick={onClose}
                className={`group flex items-baseline gap-4 border-b border-white/10 py-4 ${pathname === item.to ? 'text-ch-blush' : ''}`}
              >
                <span className="font-num text-[11px] text-ch-blush/60">{String(i + 1).padStart(2, '0')}</span>
                <span className="font-display text-[2rem] leading-none transition group-hover:translate-x-1 group-hover:text-ch-blush rtl:group-hover:-translate-x-1">
                  {t(item.labelKey)}
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <div className="mt-8 grid grid-cols-2 gap-3 text-sm">
          <Link to="/wishlist" onClick={onClose} className="rounded-full border border-white/15 px-4 py-3 text-center">
            {t('nav.wishlist')}
          </Link>
          <Link to={user ? '/account' : '/sign-in'} onClick={onClose} className="rounded-full border border-white/15 px-4 py-3 text-center">
            {user ? t('nav.account') : t('nav.signIn')}
          </Link>
          <button type="button" onClick={toggleLocale} className="rounded-full border border-white/15 px-4 py-3">
            {locale === 'en' ? 'العربية' : 'English'}
          </button>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            aria-label={t('common.currency')}
            className="rounded-full border border-white/15 bg-transparent px-4 py-3 text-center"
          >
            <option value="EGP" className="text-ch-pine">EGP</option>
            <option value="USD" className="text-ch-pine">USD</option>
          </select>
        </div>
      </nav>

      <div className="ch-container flex items-center justify-between gap-4 border-t border-white/10 py-5">
        <LogoMark className="h-8 w-auto text-ch-blush/40" />
        <a
          href={whatsappHref(listingWhatsAppMessage(pathname))}
          target="_blank"
          rel="noreferrer"
          className="ch-btn-blush"
          onClick={onClose}
        >
          {t('nav.whatsappUs')}
        </a>
      </div>
    </div>
  );
}
