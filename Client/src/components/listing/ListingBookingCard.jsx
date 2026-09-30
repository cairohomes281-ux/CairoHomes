import { useMemo, useState } from 'react';
import { ArrowUpRight, Star } from 'lucide-react';
import { getMinimumStayNights } from '../../utils/bookingRules';
import { useCurrency } from '../../context/CurrencyContext';
import { useLocale } from '../../context/LocaleContext';
import { housekeepingFeeForUnit } from '../../utils/housekeeping';
import { resolveBeachAccessRates } from '../../utils/beachAccess';
import { brand, whatsappHref, listingWhatsAppMessage } from '../../theme/brand';
import { getDisplayPriceEgp } from '../../utils/displayPrice';
import BookingDrawer from '../booking/BookingDrawer';
import { LogoMark } from '../brand/Logo';

const WA_PATH =
  'M20.52 3.48A11.94 11.94 0 0012.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.36-1.66a11.86 11.86 0 005.68 1.45h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.23-6.15-3.39-8.45zM12.05 21.79h-.01a9.86 9.86 0 01-5.03-1.38l-.36-.21-3.77.99 1.01-3.68-.24-.38a9.84 9.84 0 01-1.51-5.26c0-5.44 4.43-9.87 9.88-9.87 2.64 0 5.12 1.03 6.98 2.9a9.81 9.81 0 012.89 6.98c0 5.44-4.43 9.87-9.84 9.87zm5.41-7.39c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.34.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.34.45-.51.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5l-.57-.01a1.1 1.1 0 00-.79.37c-.27.3-1.04 1.01-1.04 2.47s1.07 2.87 1.21 3.07c.15.2 2.1 3.21 5.08 4.5.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35z';

function WhatsAppIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={WA_PATH} />
    </svg>
  );
}

export default function ListingBookingCard({
  unit,
  blockedDates = [],
  checkoutDates = [],
  dailyPrices = {},
  initialCheckin = '',
  initialCheckout = '',
  initialGuests,
}) {
  const { t } = useLocale();
  const { formatPrice } = useCurrency();
  const money = (n) => formatPrice(n, { perNight: false }) || '—';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const inquiryOnly = Boolean(unit?.disable_automatic_reservations);

  const todayKey = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }, []);

  const todayFromCalendar = Number(dailyPrices?.[todayKey] || 0);
  const pricePerNight =
    todayFromCalendar > 0 ? todayFromCalendar : getDisplayPriceEgp(unit);

  const cleaning = housekeepingFeeForUnit(unit);
  const minNights = getMinimumStayNights(unit);
  const beach = resolveBeachAccessRates(unit, minNights);
  const rating = Number(unit?.average_rating || 0);
  const reviewCount = Number(unit?.review_count || 0);

  const guestSeed =
    typeof initialGuests === 'number' && initialGuests > 0
      ? { adults: initialGuests, children: 0, infants: 0 }
      : initialGuests && typeof initialGuests === 'object'
        ? initialGuests
        : { adults: 1, children: 0, infants: 0 };

  const beachSummary = (() => {
    if (beach.mode === 'free') {
      return t('listing.beachFree');
    }
    if (beach.mode === 'flat') {
      return t('listing.beachFlatStay', { amount: money(beach.flat || beach.adult) });
    }
    if (beach.mode === 'tiered') {
      return t('listing.tieredAccessSummary');
    }
    if (!(beach.adult > 0)) return null;
    const dayLabel = beach.days === 1 ? t('common.day') : t('common.days');
    if (beach.extra > 0 && beach.extra !== beach.adult) {
      return t('listing.beachBaseExtra', { adult: money(beach.adult), extra: money(beach.extra), days: beach.days, dayLabel });
    }
    return t('listing.beachPerGuest', { adult: money(beach.adult), days: beach.days, dayLabel });
  })();

  const listingUrl = useMemo(() => {
    const base = String(brand.domain || '').replace(/\/$/, '');
    if (unit?.slug) return `${base}/listings/${unit.slug}`;
    if (typeof window !== 'undefined') return window.location.href;
    return base;
  }, [unit?.slug]);

  const inquiryHref = whatsappHref(listingWhatsAppMessage(listingUrl));

  const rows = [
    cleaning > 0 && { label: t('listing.housekeepingLabel'), value: money(cleaning), hint: t('listing.oncePerStay') },
    minNights > 1 && { label: t('listing.minStayLabel'), value: t('listing.nightsCount', { count: minNights }) },
    { label: t('listing.checkInOutLabel'), value: t('listing.checkInOutValue') },
    beachSummary && { label: t('listing.clubAccessLabel'), value: beachSummary },
  ].filter(Boolean);

  const conciergeLink = (
    <a
      href={inquiryHref}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-2xl border border-ch-line px-4 py-3 transition hover:border-ch-pine/35 hover:bg-ch-ivory"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#25d366]/10 text-[#1c9e4e]">
        <WhatsAppIcon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-ch-pine-dark">{t('listing.askConcierge')}</span>
        <span className="block truncate text-[11.5px] text-ch-muted">{t('listing.conciergeSub')}</span>
      </span>
      <ArrowUpRight size={16} className="text-ch-muted transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ch-pine rtl:-scale-x-100" />
    </a>
  );

  return (
    <>
      <div className="md:sticky md:top-[116px]">
        <div className="relative overflow-hidden rounded-[2rem] bg-white shadow-[0_40px_80px_-45px_rgba(30,63,59,0.55)] ring-1 ring-ch-line">
          <div className="relative overflow-hidden bg-ch-rose px-7 pb-8 pt-6">
            <LogoMark
              className="pointer-events-none absolute -bottom-6 -end-4 h-36 w-auto text-ch-pine/[0.07]"
              strokeWidth={2}
              title=""
            />
            <div className="relative flex items-center justify-between gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-ch-clay">
                {inquiryOnly ? t('listing.inquiryOnly') : t('listing.yourStay')}
              </span>
              {reviewCount > 0 ? (
                <a href="#reviews" className="inline-flex items-center gap-1 text-[12px] font-semibold text-ch-pine-dark">
                  <Star size={13} className="text-ch-clay" fill="currentColor" strokeWidth={0} />
                  {rating.toFixed(1)}
                  <span className="font-normal text-ch-muted">· {t('listing.reviewCount', { count: reviewCount })}</span>
                </a>
              ) : null}
            </div>
            <div className="relative mt-5 flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-[2.7rem] font-light leading-none tracking-tight text-ch-pine-dark">
                {pricePerNight != null ? money(pricePerNight) : t('listing.ratesOnRequest')}
              </span>
              {pricePerNight != null ? (
                <span className="font-display text-[15px] italic text-ch-muted">{t('listing.perNightWord')}</span>
              ) : null}
            </div>
            <p className="relative mt-2 text-[12px] text-ch-muted">{t('listing.tonightRate')}</p>
          </div>

          <div className="relative h-0" aria-hidden="true">
            <span className="absolute -start-3.5 -top-3.5 h-7 w-7 rounded-full bg-ch-ivory ring-1 ring-ch-line" />
            <span className="absolute -end-3.5 -top-3.5 h-7 w-7 rounded-full bg-ch-ivory ring-1 ring-ch-line" />
            <div className="mx-7 border-t-2 border-dashed border-ch-pine/15" />
          </div>

          <div className="px-7 pb-7 pt-6">
            <dl className="space-y-3">
              {rows.map((row) => (
                <div key={row.label} className="flex items-baseline gap-2 text-[13px]">
                  <dt className="shrink-0 text-ch-muted">{row.label}</dt>
                  <span className="mb-1 h-px flex-1 border-b border-dotted border-ch-pine/25" />
                  <dd className="max-w-[60%] text-end font-semibold text-ch-pine-dark">
                    {row.value}
                    {row.hint ? <span className="block text-[10.5px] font-normal text-ch-muted">{row.hint}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>

            {inquiryOnly ? (
              <p className="mt-5 rounded-2xl bg-ch-ivory px-4 py-3 text-[12.5px] leading-relaxed text-ch-muted">
                {t('listing.inquiryOnlyNote')}
              </p>
            ) : null}

            <div className="mt-6 space-y-3">
              {inquiryOnly ? (
                <a
                  href={inquiryHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex w-full items-center justify-between rounded-full bg-ch-pine py-2 pe-2 ps-6 text-white transition hover:bg-ch-pine-dark"
                >
                  <span className="text-[12.5px] font-semibold uppercase tracking-[0.18em]">{t('listing.whatsappInquiry')}</span>
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-[#25d366] text-white">
                    <WhatsAppIcon />
                  </span>
                </a>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className="group flex w-full items-center justify-between rounded-full bg-ch-pine py-2 pe-2 ps-6 text-white transition hover:bg-ch-pine-dark"
                  >
                    <span className="text-[12.5px] font-semibold uppercase tracking-[0.18em]">{t('listing.reserveDates')}</span>
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-ch-blush text-ch-pine-dark transition group-hover:rotate-45">
                      <ArrowUpRight size={18} className="rtl:-scale-x-100" />
                    </span>
                  </button>
                  {conciergeLink}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ch-line bg-ch-ivory/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        {inquiryOnly ? (
          <a
            href={inquiryHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-ch-pine py-3.5 text-[12.5px] font-semibold uppercase tracking-[0.16em] text-white"
          >
            <WhatsAppIcon />
            {t('listing.whatsappInquiry')}
          </a>
        ) : (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-[1.35rem] font-light leading-tight text-ch-pine-dark">
                {pricePerNight != null ? money(pricePerNight) : t('listing.inquire')}
                {pricePerNight != null && (
                  <span className="font-display text-[12px] italic text-ch-muted"> {t('listing.perNightWord')}</span>
                )}
              </div>
              <div className="truncate text-[11px] text-ch-muted">{t('listing.housekeepingShort', { amount: money(cleaning) })}</div>
            </div>
            <a
              href={inquiryHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('listing.whatsappInquiry')}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-ch-line bg-white text-[#1c9e4e]"
            >
              <WhatsAppIcon size={20} />
            </a>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="shrink-0 rounded-full bg-ch-pine px-6 py-3.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-white hover:bg-ch-pine-dark"
            >
              {t('listing.reserve')}
            </button>
          </div>
        )}
      </div>

      {!inquiryOnly ? (
        <BookingDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          unit={unit}
          blockedDates={blockedDates}
          checkoutDates={checkoutDates}
          dailyPrices={dailyPrices}
          initialCheckin={initialCheckin || ''}
          initialCheckout={initialCheckout || ''}
          initialGuests={guestSeed}
        />
      ) : null}
    </>
  );
}
