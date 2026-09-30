import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bath, BedDouble, ChevronLeft, ChevronRight, Heart, Maximize2, Star, Users } from 'lucide-react';
import { useCurrency } from '../context/CurrencyContext';
import { useLocale } from '../context/LocaleContext';
import { getListingWpId, useWishlist } from '../hooks/useWishlist';
import { optimizeImageUrl } from '../utils/imageUrl';
import { getDisplayPriceEgp } from '../utils/displayPrice';

export default function ListingCard({ listing, carryDates, wishlistMode = false, onRemove, priority = false, variant = 'default' }) {
  const { formatPrice } = useCurrency();
  const { t } = useLocale();
  const { has, toggle, remove } = useWishlist();
  const removeFromWishlist = onRemove || remove;
  const isLongTerm = String(listing.listing_type || 'rent').toLowerCase() === 'long_term';
  const isArch = variant === 'arch';
  const photos = (() => {
    const list = [];
    if (listing.cover_url) list.push(listing.cover_url);
    for (const url of listing.photo_urls || []) {
      if (url && !list.includes(url)) list.push(url);
    }
    return list.slice(0, 6).map((url) => optimizeImageUrl(url, { width: 760 }));
  })();

  const [index, setIndex] = useState(0);
  const wpId = getListingWpId(listing);
  const wished = has(wpId);
  const amount = getDisplayPriceEgp(listing);
  const priceCore = amount != null ? formatPrice(amount, { perNight: false }) : null;
  const sizeM2 = Number(listing.size_m2 || listing.unit_area || 0);
  const reviewCount = Number(listing.review_count || listing.reviewCount || 0);
  const rating = Number(listing.average_rating || listing.averageRating || listing.rating || 0);

  const location = [...new Set([listing.compound, listing.area, listing.city].filter(Boolean))].join(' · ')
    || 'Cairo, Egypt';

  const params = new URLSearchParams();
  if (carryDates?.checkin) params.set('checkin', carryDates.checkin);
  if (carryDates?.checkout) params.set('checkout', carryDates.checkout);
  if (!isLongTerm && carryDates?.guests) params.set('guests', carryDates.guests);
  const qs = params.toString();
  const href = `/listings/${listing.slug}${qs ? `?${qs}` : ''}`;

  function step(delta) {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIndex((i) => (i + delta + photos.length) % photos.length);
    };
  }

  return (
    <Link to={href} className="group flex flex-col">
      <div
        className={`relative overflow-hidden bg-ch-sand ${
          isArch ? 'ch-arch aspect-[4/5]' : 'aspect-[4/3.6] rounded-[1.6rem]'
        }`}
      >
        {photos.length ? (
          <img
            src={photos[index]}
            alt={listing.title}
            width={760}
            height={900}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={priority ? 'high' : 'auto'}
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 25vw"
            className="h-full w-full object-cover transition duration-[1.4s] ease-ch group-hover:scale-[1.05]"
            draggable={false}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-sm text-ch-muted">{t('listing.noPhoto')}</div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ch-ink/45 to-transparent opacity-80" />

        {isLongTerm && (
          <span className={`absolute start-4 rounded-full bg-ch-ivory/95 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ch-pine ${isArch ? 'top-[22%]' : 'top-4'}`}>
            {t('listing.longTermBadge')}
          </span>
        )}

        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={step(-1)}
              className="absolute start-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-ch-ivory/90 text-ch-pine opacity-0 shadow-sm transition group-hover:opacity-100"
              aria-label={t('common.previousMonth')}
            >
              <ChevronLeft size={16} className="rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={step(1)}
              className="absolute end-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-ch-ivory/90 text-ch-pine opacity-0 shadow-sm transition group-hover:opacity-100"
              aria-label={t('common.nextMonth')}
            >
              <ChevronRight size={16} className="rtl:rotate-180" />
            </button>
          </>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (wishlistMode && wished) removeFromWishlist(listing);
            else toggle({ ...listing, wp_post_id: wpId, listing_wp_id: wpId });
          }}
          className={`absolute end-4 grid h-10 w-10 place-items-center rounded-full bg-ch-ivory/90 backdrop-blur transition hover:scale-105 ${isArch ? 'top-[22%]' : 'top-4'}`}
          aria-label={wishlistMode ? t('account.removeWishlist') : t('nav.wishlist')}
        >
          <Heart size={16} strokeWidth={1.8} className={wished ? 'fill-ch-clay text-ch-clay' : 'text-ch-pine'} />
        </button>

        <div className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
          {priceCore ? (
            <span className="rounded-full bg-ch-ivory/95 px-3.5 py-1.5 text-ch-pine-dark backdrop-blur">
              <span className="font-num text-[14px] font-semibold">{priceCore}</span>
              <span className="ms-1 text-[11.5px] text-ch-muted">{isLongTerm ? t('listing.perMonthShort') : t('listing.perNightShort')}</span>
            </span>
          ) : (
            <span className="rounded-full bg-ch-ivory/95 px-3.5 py-1.5 text-[12px] text-ch-muted">
              {isLongTerm ? t('listing.inquireForPrice') : t('listing.viewPricing')}
            </span>
          )}
          {photos.length > 1 && (
            <span className="flex gap-1 pb-2">
              {photos.map((_, i) => (
                <span key={i} className={`h-1 rounded-full transition-all ${i === index ? 'w-4 bg-ch-ivory' : 'w-1 bg-ch-ivory/55'}`} />
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="px-1 pt-4">
        <div className="flex items-start justify-between gap-3">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.2em] text-ch-clay">{location}</p>
          {!isLongTerm && (
            <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-ch-pine">
              <Star size={13} className={reviewCount > 0 ? 'fill-ch-clay text-ch-clay' : 'text-ch-muted'} />
              {reviewCount > 0 ? (
                <>
                  <span className="font-num font-semibold">{rating.toFixed(1)}</span>
                  <span className="text-ch-muted">({reviewCount})</span>
                </>
              ) : (
                <span className="text-ch-muted">{t('listing.newListing')}</span>
              )}
            </span>
          )}
        </div>
        <h3 className="mt-1.5 line-clamp-1 font-display text-[1.3rem] leading-snug text-ch-pine-dark transition-colors group-hover:text-ch-clay">
          {listing.title}
        </h3>
        <div className="mt-2 flex items-center gap-x-4 text-[12.5px] text-ch-muted">
          {(listing.beds ?? 0) > 0 && <Spec icon={BedDouble} value={listing.beds} />}
          {(listing.baths ?? 0) > 0 && <Spec icon={Bath} value={listing.baths} />}
          {(listing.guests ?? 0) > 0 && <Spec icon={Users} value={listing.guests} />}
          {isLongTerm && sizeM2 > 0 && <Spec icon={Maximize2} value={`${sizeM2} m²`} />}
        </div>
      </div>
    </Link>
  );
}

function Spec({ icon: Icon, value }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <Icon size={14} strokeWidth={1.6} className="text-ch-pine/60" />
      <span className="font-num font-medium text-ch-pine">{value}</span>
    </span>
  );
}

export function ListingCardSkeleton({ variant = 'default' }) {
  return (
    <div className="animate-pulse">
      <div className={`bg-ch-sand ${variant === 'arch' ? 'ch-arch aspect-[4/5]' : 'aspect-[4/3.6] rounded-[1.6rem]'}`} />
      <div className="space-y-2 px-1 pt-4">
        <div className="h-3 w-1/3 rounded bg-ch-sand" />
        <div className="h-5 w-3/4 rounded bg-ch-sand" />
        <div className="h-3 w-1/2 rounded bg-ch-sand" />
      </div>
    </div>
  );
}
