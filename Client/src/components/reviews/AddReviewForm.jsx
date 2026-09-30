import { useState } from 'react';
import { Star } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

const MAX_COMMENT_LENGTH = 500;

export default function AddReviewForm({ onSubmit, submitting = false }) {
  const { t } = useLocale();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const activeRating = hoverRating || rating;

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!rating) {
      setError(t('listing.needRating'));
      return;
    }

    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      setError(t('listing.needComment'));
      return;
    }

    setError('');
    const success = await onSubmit({ rating, comment: trimmedComment });

    if (success) {
      setRating(0);
      setHoverRating(0);
      setComment('');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-[1.75rem] border border-ch-line bg-white p-6"
    >
      <div className="space-y-1.5">
        <h3 className="font-display text-xl font-light text-ch-pine-dark">{t('listing.addReviewTitle')}</h3>
        <p className="text-[12.5px] leading-relaxed text-ch-muted">
          {t('listing.addReviewBody')}
        </p>
      </div>

      <div className="flex items-center gap-1" role="radiogroup" aria-label={t('listing.selectRating')}>
        {Array.from({ length: 5 }, (_, index) => {
          const value = index + 1;
          const filled = value <= activeRating;

          return (
            <button
              key={value}
              type="button"
              onClick={() => setRating(value)}
              onMouseEnter={() => setHoverRating(value)}
              onMouseLeave={() => setHoverRating(0)}
              className={`p-1 transition-transform hover:scale-110 ${filled ? 'text-ch-clay' : 'text-ch-pine/25'}`}
              aria-label={t('listing.rateStars', { count: value })}
            >
              <Star className="h-6 w-6" strokeWidth={1.6} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="review-comment" className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ch-clay">
          {t('listing.comment')}
        </label>
        <textarea
          id="review-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value.slice(0, MAX_COMMENT_LENGTH))}
          rows={4}
          maxLength={MAX_COMMENT_LENGTH}
          placeholder={t('listing.commentPlaceholder')}
          className="w-full resize-none border-0 border-b border-ch-line bg-transparent px-0 py-2 text-sm leading-6 text-ch-pine-dark outline-none transition-colors placeholder:text-ch-muted/60 focus:border-ch-pine focus:ring-0"
        />
        <p className="text-end font-num text-[10.5px] text-ch-muted">
          {comment.length}/{MAX_COMMENT_LENGTH}
        </p>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex w-full items-center justify-center rounded-full bg-ch-pine px-6 py-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-white transition-colors hover:bg-ch-pine-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? t('listing.submitting') : t('listing.postReview')}
      </button>
    </form>
  );
}
