import { useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

const INITIAL_VISIBLE = 5;

function ReviewStars({ value, size = 14, className = 'text-ch-clay' }) {
  const { t } = useLocale();
  const rounded = Math.round(Number(value) || 0);

  return (
    <div className={`flex items-center gap-0.5 ${className}`} aria-label={t('listing.starRatingOutOf', { count: rounded })}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          size={size}
          fill={index + 1 <= rounded ? 'currentColor' : 'none'}
          strokeWidth={1.6}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function Author({ review, formatDate }) {
  const { t } = useLocale();
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-11 w-10 shrink-0 place-items-center rounded-t-full rounded-b-md bg-ch-rose font-display text-[13px] text-ch-clay">
        {initials(review.guestName)}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-semibold text-ch-pine-dark">{review.guestName || t('common.guest')}</p>
        <p className="text-[11.5px] text-ch-muted">{formatDate(review.createdAt || review.created_at)}</p>
      </div>
      <ReviewStars value={review.rating} size={12} className="ms-auto text-ch-clay" />
    </div>
  );
}

export default function UnitReviewsDisplay({
  reviews = [],
  unitAverageRating = 0,
  unitReviewCount = 0,
  loading = false,
  error = '',
  aside = null,
}) {
  const { t, localeTag } = useLocale();
  const [showAll, setShowAll] = useState(false);

  const formatDate = (value) => {
    if (!value) return t('listing.recently');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('listing.recently');
    return date.toLocaleDateString(localeTag, { month: 'long', year: 'numeric' });
  };

  const summary = useMemo(() => {
    if (!reviews.length) {
      return {
        averageRating: Number(unitAverageRating || 0),
        reviewCount: Number(unitReviewCount || 0),
      };
    }
    const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
    return {
      averageRating: total / reviews.length,
      reviewCount: reviews.length,
    };
  }, [reviews, unitAverageRating, unitReviewCount]);

  const distribution = useMemo(() => {
    const counts = [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: reviews.filter((r) => Math.round(Number(r.rating) || 0) === stars).length,
    }));
    const max = Math.max(1, ...counts.map((c) => c.count));
    return counts.map((c) => ({ ...c, pct: (c.count / max) * 100 }));
  }, [reviews]);

  const [featured, ...rest] = reviews;
  const visibleRest = showAll ? rest : rest.slice(0, INITIAL_VISIBLE - 1);
  const hasScore = summary.reviewCount > 0;

  return (
    <div className="grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-14">
      <div className="space-y-5">
        <div className="relative overflow-hidden rounded-t-[999px] rounded-b-[1.75rem] bg-ch-pine-dark px-6 pb-7 pt-14 text-center text-ch-ivory">
          <div className="pointer-events-none absolute inset-x-4 top-4 bottom-0 rounded-t-[999px] border border-b-0 border-white/10" />
          <p className="relative text-[10px] font-semibold uppercase tracking-[0.3em] text-ch-blush/80">
            {t('listing.guestFeedback')}
          </p>
          <div className="relative mt-3 font-display text-[4.2rem] font-light leading-none">
            {hasScore ? summary.averageRating.toFixed(1) : '—'}
          </div>
          <ReviewStars value={summary.averageRating} size={15} className="relative mt-3 justify-center text-ch-blush" />
          <p className="relative mt-2 text-[12px] text-ch-ivory/60">
            {hasScore ? t('listing.reviewCount', { count: summary.reviewCount }) : t('listing.noReviewsYet')}
          </p>

          {reviews.length > 0 ? (
            <div className="relative mt-6 space-y-1.5 border-t border-white/10 pt-5">
              {distribution.map((row) => (
                <div key={row.stars} className="flex items-center gap-2.5 text-[11px] text-ch-ivory/60">
                  <span className="w-3 font-num">{row.stars}</span>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full rounded-full bg-ch-blush" style={{ width: `${row.pct}%` }} />
                  </span>
                  <span className="w-4 text-end font-num">{row.count}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {aside}
      </div>

      <div className="min-w-0">
        {loading ? <p className="text-sm text-ch-muted">{t('listing.loadingReviews')}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {!loading && !error && reviews.length === 0 ? (
          <div className="flex h-full min-h-[220px] flex-col items-start justify-center rounded-[1.75rem] border border-dashed border-ch-pine/20 p-8">
            <span className="font-display text-6xl leading-none text-ch-blush">&ldquo;</span>
            <p className="mt-2 max-w-sm font-display text-xl font-light text-ch-pine-dark">{t('listing.reviewsEmpty')}</p>
          </div>
        ) : null}

        {featured ? (
          <figure className="relative pb-8">
            <span aria-hidden="true" className="absolute -top-6 start-0 font-display text-[6.5rem] leading-none text-ch-blush">
              &ldquo;
            </span>
            <blockquote className="relative pt-10 font-display text-[1.45rem] font-light leading-[1.45] text-ch-pine-dark sm:text-[1.65rem]">
              {featured.comment}
            </blockquote>
            <figcaption className="mt-6 max-w-sm">
              <Author review={featured} formatDate={formatDate} />
            </figcaption>
          </figure>
        ) : null}

        {visibleRest.length > 0 ? (
          <ul className="border-t border-ch-line">
            {visibleRest.map((review) => (
              <li
                key={review.id || `${review.guestName}-${review.createdAt}`}
                className="border-b border-ch-line py-6"
              >
                <p className="text-[14.5px] leading-7 text-ch-ink/80">{review.comment}</p>
                <div className="mt-4">
                  <Author review={review} formatDate={formatDate} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {rest.length > INITIAL_VISIBLE - 1 ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-ch-pine underline decoration-ch-blush decoration-2 underline-offset-8 transition hover:text-ch-clay"
          >
            {showAll ? t('listing.showLess') : t('listing.readAllReviews', { count: reviews.length })}
          </button>
        ) : null}
      </div>
    </div>
  );
}
