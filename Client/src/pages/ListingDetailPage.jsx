import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import ListingCard from '../components/ListingCard';
import ListingBookingCard from '../components/listing/ListingBookingCard';
import ListingLongTermCard from '../components/listing/ListingLongTermCard';
import AddReviewForm from '../components/reviews/AddReviewForm';
import UnitReviewsDisplay from '../components/reviews/UnitReviewsDisplay';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import api, { createUnitReview, fetchUnitReviews } from '../api/http';
import { optimizeImageUrl } from '../utils/imageUrl';
import { GUEST_AVAILABILITY_MONTHS } from '../constants/availability';
import BrandLoader from '../components/ui/BrandLoader';

const localISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const isLongTermUnit = (unit) => String(unit?.listing_type || 'rent').toLowerCase() === 'long_term';

function parseFacilities(unit) {
  if (Array.isArray(unit?.facilities) && unit.facilities.length) return unit.facilities;
  if (!unit?.other_details) return [];
  try {
    const parsed = typeof unit.other_details === 'string' ? JSON.parse(unit.other_details) : unit.other_details;
    return Array.isArray(parsed?.facilities) ? parsed.facilities : [];
  } catch {
    return [];
  }
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-none text-ch-pine" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function Spec({ num, label }) {
  return (
    <div className="text-center py-3 border border-ch-line rounded-[14px]">
      <div className="font-num text-[28px] font-semibold leading-none text-ch-pine">{num}</div>
      <div className="text-[12px] text-ch-muted mt-1.5 uppercase tracking-wider font-semibold">{label}</div>
    </div>
  );
}

function ExpandableText({ text, limit = 320 }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const needs = text.length > limit;
  const shown = !needs || open ? text : `${text.slice(0, limit).trim()}…`;
  return (
    <div>
      <p className="text-[15px] text-ch-pine/90 leading-relaxed whitespace-pre-line m-0">{shown}</p>
      {needs && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-sm font-semibold text-ch-pine underline"
        >
          {open ? t('listing.showLess') : t('listing.readMore')}
        </button>
      )}
    </div>
  );
}

const GUEST_REGULATION_KEYS = [
  'listing.reg0',
  'listing.reg1',
  'listing.reg2',
  'listing.reg3',
  'listing.reg4',
];

export default function ListingDetailPage() {
  const { t } = useLocale();
  const { slug } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [unit, setUnit] = useState(null);
  const [blocked, setBlocked] = useState([]);
  const [checkoutDates, setCheckoutDates] = useState([]);
  const [prices, setPrices] = useState({});
  const [similar, setSimilar] = useState([]);
  const [lightbox, setLightbox] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewsError, setReviewsError] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewMessage, setReviewMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setUnit(null);
    setNotFound(false);

    api
      .get(`/units/${slug}`)
      .then((r) => {
        if (!cancelled) setUnit(r.data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (!unit) return undefined;
    let cancelled = false;
    const from = localISO(new Date());
    const toDate = new Date();
    toDate.setMonth(toDate.getMonth() + GUEST_AVAILABILITY_MONTHS);
    const to = localISO(toDate);

    api
      .get(`/units/${slug}/availability`, { params: { from, to } })
      .then((r) => {
        if (!cancelled) {
          const nights = (r.data.blocked || []).map((b) => b.date);
          const occupied = new Set(nights);
          const turnover = (r.data.checkout_dates || []).filter((d) => !occupied.has(d));
          setCheckoutDates(turnover);
          setBlocked(nights);
        }
      })
      .catch(() => {});

    if (!isLongTermUnit(unit)) {
      api
        .get(`/units/${slug}/pricing`, { params: { from, to } })
        .then((r) => {
          if (!cancelled) setPrices(r.data.prices || {});
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [slug, unit]);

  useEffect(() => {
    if (!unit) return undefined;
    let cancelled = false;
    const listingType = isLongTermUnit(unit) ? 'long_term' : 'rent';
    api
      .get('/units', {
        params: {
          status: 'published',
          compound: unit.compound || undefined,
          listing_type: listingType,
          limit: 6,
        },
      })
      .then((r) => {
        if (cancelled) return;
        const items = (r.data.items || []).filter((u) => u.slug !== unit.slug).slice(0, 3);
        setSimilar(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [unit]);

  useEffect(() => {
    if (!unit?.id && !unit?.slug) return undefined;
    if (isLongTermUnit(unit)) return undefined;
    let cancelled = false;
    setReviewsLoading(true);
    setReviewsError('');
    fetchUnitReviews(unit.slug || unit.id)
      .then((data) => {
        if (cancelled) return;
        setReviews(data.items || []);
        setUnit((current) =>
          current
            ? {
                ...current,
                average_rating: data.average_rating ?? current.average_rating,
                review_count: data.review_count ?? current.review_count,
              }
            : current
        );
      })
      .catch(() => {
        if (!cancelled) setReviewsError(t('listing.loadReviewsFailed'));
      })
      .finally(() => {
        if (!cancelled) setReviewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [unit?.id, unit?.slug]);

  const handleReviewSubmit = async ({ rating, comment }) => {
    if (!unit) return false;
    setReviewSubmitting(true);
    setReviewMessage('');
    try {
      const guestName =
        user?.full_name || user?.fullName || user?.user_metadata?.full_name || user?.email || t('common.guest');
      const data = await createUnitReview(unit.id || unit.slug, { rating, comment, guestName });
      if (data.review) {
        setReviews((prev) => [data.review, ...prev]);
      }
      setUnit((current) =>
        current
          ? {
              ...current,
              average_rating: data.average_rating ?? current.average_rating,
              review_count: data.review_count ?? current.review_count,
            }
          : current
      );
      setReviewMessage(t('listing.thanksReview'));
      return true;
    } catch (err) {
      setReviewMessage(err.response?.data?.error || t('listing.postFailed'));
      return false;
    } finally {
      setReviewSubmitting(false);
    }
  };

  const photos = useMemo(() => {
    if (!unit) return [];
    const list = [];
    if (unit.cover_url) list.push(unit.cover_url);
    for (const url of unit.photo_urls || []) {
      if (url && !list.includes(url)) list.push(url);
    }
    return list.map((url, i) => optimizeImageUrl(url, { width: i === 0 ? 1400 : 800 }));
  }, [unit]);

  const facilities = useMemo(() => (unit ? parseFacilities(unit) : []), [unit]);
  const amenities = unit?.amenities || [];

  const locationParts = useMemo(() => {
    if (!unit) return [];
    return [...new Map(
      [unit.compound, unit.area, unit.city]
        .filter((p) => p && String(p).trim())
        .map((p) => [String(p).trim().toLowerCase(), String(p).trim()])
    ).values()];
  }, [unit]);

  const description = unit?.the_property || unit?.short_description || '';

  if (notFound) {
    return (
      <div>
        <Header />
        <main className="mx-auto max-w-[1280px] px-6 py-20 text-center">
          <h1 className="font-display text-3xl text-ch-pine mb-3">{t('listing.notFound')}</h1>
          <Link to="/search" className="text-ch-pine font-semibold underline">
            {t('listing.browseStays')}
          </Link>
          <span className="mx-2 text-ch-muted">·</span>
          <Link to="/long-term" className="text-ch-pine font-semibold underline">
            {t('listing.browseLongTerm')}
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  if (!unit) {
    return (
      <div>
        <Header />
        <BrandLoader fullPage size="lg" label={t('listing.loading')} />
        <Footer />
      </div>
    );
  }

  const isLongTerm = isLongTermUnit(unit);
  const browsePath = isLongTerm ? '/long-term' : '/search';
  const sizeM2 = Number(unit.size_m2 || unit.unit_area || 0);

  const detailRows = [
    { label: t('listing.specGuests'), value: String(unit.guests || '—') },
    { label: t('listing.specBedrooms'), value: String(unit.beds ?? '—') },
    { label: t('listing.specBaths'), value: String(unit.baths ?? '—') },
    ...(isLongTerm && sizeM2 > 0 ? [{ label: t('listing.specArea'), value: `${sizeM2} m²` }] : []),
    { label: t('listing.specCheckIn'), value: t('listing.specCheckInValue') },
    { label: t('listing.specCheckOut'), value: t('listing.specCheckOutValue') },
    ...(unit.property_type ? [{ label: t('listing.specPropertyType'), value: unit.property_type }] : []),
  ];

  return (
    <div className="bg-ch-ivory">
      <Header />
      <main id="main">
        <div className="ch-container">
          
          <div className="py-6 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-ch-muted">
            <Link to="/" className="hover:text-ch-pine">
              {t('listing.egypt')}
            </Link>
            {locationParts.map((part) => (
              <span key={part}>
                {' · '}
                <Link to={`${browsePath}?area=${encodeURIComponent(part)}`} className="hover:text-ch-pine">
                  {part}
                </Link>
              </span>
            ))}
            {' · '}
            <span>{unit.title}</span>
          </div>

          
          <div className="flex justify-between items-end flex-wrap gap-4 mb-8">
            <div>
              {locationParts[0] && (
                <p className="ch-eyebrow text-ch-clay mb-4">
                  {isLongTerm ? t('listing.longTermIn', { place: locationParts[0] }) : locationParts[0]}
                </p>
              )}
              <h1 className="font-display text-[clamp(2.2rem,4.6vw,3.8rem)] font-light leading-[1.02] mb-4 text-ch-pine-dark">
                {unit.title}
              </h1>
              <div className="text-ch-muted text-sm">
                <strong className="text-ch-pine">{locationParts[0] || t('listing.egypt')}</strong>
                {locationParts.length > 1 ? `, ${locationParts.slice(1).join(', ')}` : ''}
              </div>
              {!isLongTerm && Number(unit.review_count || 0) > 0 ? (
                <p className="mt-2 text-sm text-ch-pine">
                  <span className="font-semibold text-ch-clay">★ {Number(unit.average_rating || 0).toFixed(1)}</span>
                  <span className="text-ch-muted"> · {t('listing.reviewCount', { count: unit.review_count })}</span>
                </p>
              ) : null}
            </div>
          </div>

          
          {photos.length > 0 ? (
            <div className="relative mb-8">
              <div className="hidden md:grid grid-cols-[2fr_1fr_1fr] grid-rows-[250px_250px] gap-3">
                <div className="md:row-span-2 relative bg-ch-sand overflow-hidden rounded-[1.5rem] rounded-ss-[12rem] rtl:rounded-ss-[1.5rem] rtl:rounded-se-[12rem]">
                  <img
                    src={photos[0]}
                    alt={unit.title}
                    fetchPriority="high"
                    decoding="async"
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                </div>
                {photos.slice(1, 5).map((p, i) => (
                  <div key={p} className="relative bg-ch-sand overflow-hidden rounded-[1.5rem]">
                    <img
                      src={p}
                      alt={t('listing.photoAlt', { title: unit.title, n: i + 2 })}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>

              <div className="md:hidden flex gap-2 overflow-x-auto scrollbar-none scroll-smooth snap-x snap-mandatory rounded-[18px] -mx-6 px-6 pb-1">
                {photos.slice(0, 8).map((p, i) => (
                  <div
                    key={p}
                    className="relative flex-none w-[88%] aspect-[4/3] bg-ch-ivory/40 overflow-hidden rounded-[14px] snap-start"
                  >
                    <img
                      src={p}
                      alt={i === 0 ? unit.title : t('listing.photoAlt', { title: unit.title, n: i + 1 })}
                      loading={i === 0 ? 'eager' : 'lazy'}
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setLightbox(true)}
                className="absolute bottom-5 end-5 rounded-full bg-ch-ivory/95 px-5 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-ch-pine backdrop-blur transition hover:bg-ch-pine hover:text-ch-ivory"
              >
                {t('listing.showAllPhotos', { count: photos.length })}
              </button>
            </div>
          ) : (
            <div className="bg-ch-ivory/50 rounded-[22px] aspect-[16/9] flex items-center justify-center text-ch-muted mb-8">
              {t('listing.noPhotos')}
            </div>
          )}

          
          <nav className="ch-glass hidden md:block sticky top-[74px] z-30 border-y border-ch-line mb-10">
            <div className="flex gap-8 overflow-x-auto px-4 text-[11.5px] font-semibold uppercase tracking-[0.18em] text-ch-muted whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:px-0">
              <a href="#about" className="py-4 hover:text-ch-pine transition-colors">
                {t('listing.description')}
              </a>
              <a href="#details" className="py-4 hover:text-ch-pine transition-colors">
                {t('listing.details')}
              </a>
              <a href="#features" className="py-4 hover:text-ch-pine transition-colors">
                {t('listing.amenitiesHeading')}
              </a>
              {!isLongTerm && (
                <>
                  <a href="#reviews" className="py-4 hover:text-ch-pine transition-colors">
                    {t('listing.reviews')}
                  </a>
                  <a href="#rules" className="py-4 hover:text-ch-pine transition-colors">
                    {t('listing.houseRules')}
                  </a>
                </>
              )}
            </div>
          </nav>

          <div className="grid grid-cols-1 md:grid-cols-[1fr_380px] gap-12 pb-[120px] md:pb-20">
            <div>
              <section className="pb-8 border-b border-ch-line mb-8">
                <div className="grid grid-cols-3 gap-3.5">
                  <Spec num={String(unit.guests || '—')} label={t('listing.specGuests')} />
                  <Spec num={String(unit.beds ?? '—')} label={t('listing.specBedrooms')} />
                  <Spec num={String(unit.baths ?? '—')} label={t('listing.specBaths')} />
                </div>
              </section>

              <section id="about" className="scroll-mt-[130px] pb-8 border-b border-ch-line mb-8">
                <h2 className="font-display text-[1.8rem] font-normal !text-ch-pine-dark mb-3.5 text-ch-pine">{t('listing.description')}</h2>
                <ExpandableText text={description} />
              </section>

              <section id="details" className="scroll-mt-[130px] pb-8 border-b border-ch-line mb-8">
                <h2 className="font-display text-[1.8rem] font-normal !text-ch-pine-dark mb-4 text-ch-pine">{t('listing.details')}</h2>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-0">
                  {detailRows.map((r) => (
                    <div
                      key={r.label}
                      className="flex justify-between gap-4 border-b border-ch-line py-2.5 text-[14.5px]"
                    >
                      <dt className="text-ch-muted">{r.label}</dt>
                      <dd className="font-semibold text-ch-pine text-end m-0">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section id="features" className="scroll-mt-[130px] pb-8 border-b border-ch-line mb-8">
                <h2 className="font-display text-[1.8rem] font-normal !text-ch-pine-dark mb-5 text-ch-pine">{t('listing.features')}</h2>

                {!!amenities.length && (
                  <>
                    <h3 className="text-[13px] font-bold uppercase tracking-wider text-ch-muted mb-3">
                      {t('listing.amenitiesHeading')}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-7">
                      {amenities.map((a) => (
                        <div key={a} className="flex items-center gap-3 text-[14.5px]">
                          <CheckIcon />
                          {a}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {!!facilities.length && (
                  <>
                    <h3 className="text-[13px] font-bold uppercase tracking-wider text-ch-muted mb-3">
                      {t('listing.facilities')}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {facilities.map((f) => (
                        <div key={f} className="flex items-center gap-3 text-[14.5px]">
                          <CheckIcon />
                          {f}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {!amenities.length && !facilities.length && (
                  <p className="text-sm text-ch-muted m-0">{t('listing.amenitiesEmpty')}</p>
                )}
              </section>

              {!isLongTerm && (
              <section id="reviews" className="scroll-mt-[130px] pb-10 border-b border-ch-line mb-8">
                <div className="mb-8">
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.28em] text-ch-clay">
                    {t('listing.guestbookEyebrow')}
                  </p>
                  <h2 className="mt-2 font-display text-[2.1rem] font-light leading-tight text-ch-pine-dark">
                    {t('listing.guestbookTitle')}{' '}
                    <em className="italic text-ch-clay">{t('listing.guestbookTitleEm')}</em>
                  </h2>
                </div>
                <UnitReviewsDisplay
                  reviews={reviews}
                  unitAverageRating={unit.average_rating}
                  unitReviewCount={unit.review_count}
                  loading={reviewsLoading}
                  error={reviewsError}
                  aside={
                    <div className="space-y-3">
                      {user ? (
                        <AddReviewForm onSubmit={handleReviewSubmit} submitting={reviewSubmitting} />
                      ) : (
                        <div className="rounded-[1.5rem] border border-dashed border-ch-pine/25 p-5">
                          <p className="font-display text-[1.1rem] text-ch-pine-dark">{t('listing.stayedWithUs')}</p>
                          <p className="mt-1 text-[12.5px] leading-relaxed text-ch-muted">{t('listing.signInGuestbook')}</p>
                          <Link
                            to="/sign-in"
                            className="mt-3 inline-block text-[11px] font-semibold uppercase tracking-[0.22em] text-ch-pine underline decoration-ch-blush decoration-2 underline-offset-8 hover:text-ch-clay"
                          >
                            {t('listing.signInCta')}
                          </Link>
                        </div>
                      )}
                      {reviewMessage ? (
                        <p className={`text-sm ${reviewMessageOk ? 'text-emerald-700' : 'text-red-600'}`}>
                          {reviewMessage}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              </section>
              )}

              {similar.length > 0 && (
                <section className="pb-8 border-b border-ch-line mb-8">
                  <div className="flex justify-between items-center mb-3.5 flex-wrap gap-3.5">
                    <h2 className="font-display text-[1.8rem] font-normal !text-ch-pine-dark m-0 text-ch-pine">
                      {isLongTerm ? t('listing.similarLongTerm') : t('listing.similarRent')}
                    </h2>
                    <Link to={browsePath} className="text-ch-pine font-semibold text-sm hover:underline">
                      {t('listing.viewAll')}
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {similar.map((l) => (
                      <ListingCard
                        key={l.id}
                        listing={l}
                        carryDates={{
                          checkin: params.get('checkin') || undefined,
                          checkout: params.get('checkout') || undefined,
                          guests: params.get('guests') || undefined,
                        }}
                      />
                    ))}
                  </div>
                </section>
              )}

              {!isLongTerm && (
                <>
                  <section id="rules" className="scroll-mt-[130px] pb-8 border-b border-ch-line mb-8">
                    <h2 className="font-display text-[1.8rem] font-normal !text-ch-pine-dark mb-3.5 text-ch-pine">{t('listing.houseRules')}</h2>
                    <ul className="space-y-1.5 text-sm text-ch-pine m-0 list-none p-0">
                      <li className="flex items-center gap-2">
                        <CheckIcon /> {t('listing.checkInAfter')}
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckIcon /> {t('listing.checkOutBefore')}
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckIcon /> {t('listing.noSmoking')}
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckIcon /> {t('listing.noParties')}
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckIcon /> {t('listing.guestsMax', { count: unit.guests || 8 })}
                      </li>
                    </ul>
                  </section>

                  <section className="pb-8 border-b border-ch-line mb-8">
                    <h2 className="font-display text-[1.8rem] font-normal !text-ch-pine-dark mb-3.5 text-ch-pine">{t('listing.guestRegulations')}</h2>
                    <ul className="space-y-2 text-sm text-ch-pine m-0 list-none p-0">
                      {GUEST_REGULATION_KEYS.map((key) => (
                        <li key={key} className="flex items-start gap-2.5">
                          <span className="mt-0.5">
                            <CheckIcon />
                          </span>
                          <span>{t(key)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </div>

            <aside>
              {isLongTerm ? (
                <ListingLongTermCard
                  unit={unit}
                  blockedDates={blocked}
                  checkoutDates={checkoutDates}
                  initialCheckin={params.get('checkin') || undefined}
                  initialCheckout={params.get('checkout') || undefined}
                />
              ) : (
                <ListingBookingCard
                  unit={unit}
                  blockedDates={blocked}
                  checkoutDates={checkoutDates}
                  dailyPrices={prices}
                  initialCheckin={params.get('checkin') || undefined}
                  initialCheckout={params.get('checkout') || undefined}
                  initialGuests={params.get('guests') ? parseInt(params.get('guests'), 10) : undefined}
                />
              )}
            </aside>
          </div>
        </div>
      </main>
      <Footer />

      {lightbox && (
        <div
          className="fixed inset-0 z-[230] bg-black/85 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={t('listing.allPhotos')}
        >
          <div className="flex items-center justify-between px-5 py-4 text-white">
            <strong className="font-display text-xl">{unit.title}</strong>
            <button
              type="button"
              onClick={() => setLightbox(false)}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20"
              aria-label={t('common.close')}
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-10">
            <div className="max-w-4xl mx-auto grid gap-3">
              {photos.map((p, i) => (
                <img key={p} src={p} alt={t('listing.photoAlt', { title: unit.title, n: i + 1 })} className="w-full rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
