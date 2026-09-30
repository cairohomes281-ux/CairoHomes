import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../../context/LocaleContext';
import { otaBlockLook } from '../../admin/utils/otaCalendar';

const dateToIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeHasBlockedNight(start, end, blockedSet, checkoutSet) {
  if (!blockedSet?.size) return false;
  for (let t = +start; t < +end; t += 86_400_000) {
    const iso = dateToIso(new Date(t));
    if (blockedSet.has(iso) && !checkoutSet?.has(iso)) return true;
  }
  return false;
}

function compactPrice(amount) {
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}k`;
  return String(amount);
}


export default function ListingDatePicker({
  value,
  onChange,
  onClose,
  anchorRef,
  blockedDates = [],
  checkoutDates = [],
  blockedSources = {},
  dailyPrices = {},
  minNights = 1,
  inline = false,
  allowPastDates = false,
}) {
  const { t, localeTag } = useLocale();
  const [view, setView] = useState(() => {
    const base = value?.start ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const blockedSet = new Set(blockedDates);
  const checkoutSet = new Set(checkoutDates);
  const isOccupiedNight = (iso) => blockedSet.has(iso) && !checkoutSet.has(iso);

  useEffect(() => {
    if (inline) return undefined;
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [inline]);

  useEffect(() => {
    if (inline || !isMobile) return undefined;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = orig;
    };
  }, [isMobile, inline]);

  useEffect(() => {
    if (inline || !anchorRef?.current || isMobile) return undefined;
    const place = () => {
      const r = anchorRef.current.getBoundingClientRect();
      const width = Math.min(580, window.innerWidth - 32);
      setPos({
        top: r.bottom + 8,
        left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place);
    };
  }, [anchorRef, isMobile, inline]);

  useEffect(() => {
    if (inline) return undefined;
    const onClick = (e) => {
      if (
        popRef.current &&
        !popRef.current.contains(e.target) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target)
      ) {
        onClose?.();
      }
    };
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef, inline]);

  function pick(d) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!allowPastDates && d < today) return;

    const isBlockedNight = isOccupiedNight(dateToIso(d));
    const choosingCheckout = !!value.start && !value.end && d > value.start;

    if (choosingCheckout) {
      if (rangeHasBlockedNight(value.start, d, blockedSet, checkoutSet)) {
        if (!isBlockedNight) onChange({ start: d, end: null });
        return;
      }
      const nights = Math.round((+d - +value.start) / 86_400_000);
      if (nights < Math.max(1, minNights || 0)) return;
      onChange({ start: value.start, end: d });
      if (!inline) setTimeout(() => onClose?.(), 250);
      return;
    }

    if (isBlockedNight) return;
    onChange({ start: d, end: null });
  }

  function summary() {
    const fmt = (d) => d.toLocaleDateString(localeTag, { month: 'short', day: 'numeric' });
    if (value.start && value.end) {
      const nights = Math.round((+value.end - +value.start) / 86_400_000);
      return t('listing.rangeSummary', { start: fmt(value.start), end: fmt(value.end), nights });
    }
    if (value.start) {
      return t('listing.checkInPickOut', { date: fmt(value.start) });
    }
    return t('listing.pickCheckIn');
  }

  const panel = (
    <div
      ref={popRef}
      className={
        inline
          ? 'bg-white border border-ch-line rounded-[22px] p-4 sm:p-5'
          : isMobile
            ? 'fixed inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto bg-white border-t border-ch-line rounded-t-[22px] shadow-2xl z-[220] p-5 pb-[max(20px,env(safe-area-inset-bottom))]'
            : 'fixed bg-white border border-ch-line rounded-[22px] shadow-2xl z-[220] p-5'
      }
      style={!inline && !isMobile && pos ? { top: pos.top, left: pos.left, minWidth: 580, maxWidth: 'calc(100vw - 32px)' } : undefined}
    >
      <div className="flex justify-between items-center mb-3.5">
        <button
          type="button"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
          className="w-8 h-8 rounded-full hover:bg-ch-pine-50 text-lg text-ch-pine"
          aria-label={t('common.previousMonth')}
        >
          ‹
        </button>
        <strong className="text-sm text-ch-pine">{t('listing.selectDates')}</strong>
        <button
          type="button"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
          className="w-8 h-8 rounded-full hover:bg-ch-pine-50 text-lg text-ch-pine"
          aria-label={t('common.nextMonth')}
        >
          ›
        </button>
      </div>

      <div className={`grid gap-6 ${inline ? 'grid-cols-1 sm:grid-cols-2 sm:gap-6' : 'grid-cols-1 md:grid-cols-2 gap-8'}`}>
        <Month
          month={view}
          value={value}
          onPick={pick}
          blockedSet={blockedSet}
          checkoutSet={checkoutSet}
          blockedSources={blockedSources}
          dailyPrices={dailyPrices}
          minNights={minNights}
          localeTag={localeTag}
          allowPastDates={allowPastDates}
        />
        <Month
          month={new Date(view.getFullYear(), view.getMonth() + 1, 1)}
          value={value}
          onPick={pick}
          blockedSet={blockedSet}
          checkoutSet={checkoutSet}
          blockedSources={blockedSources}
          dailyPrices={dailyPrices}
          minNights={minNights}
          localeTag={localeTag}
          allowPastDates={allowPastDates}
        />
      </div>

      {allowPastDates && (
        <div className="mt-2 rounded-[12px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
          Past dates are allowed — verify there are no conflicts before saving.
        </div>
      )}

      {blockedSet.size > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 text-[11.5px] text-ch-muted">
          <div className="flex items-center gap-2">
            <span className="inline-grid place-items-center w-5 h-5 rounded-full bg-[#f4f5f7] border border-[#e3e8ef] text-ch-muted/50 text-[11px] line-through">
              14
            </span>
            {t('listing.blockedHint')}
          </div>
          {Object.values(blockedSources || {}).some((src) => otaBlockLook(src)) && (
            <div className="flex items-center gap-2">
              <span className="rounded px-1 py-px text-[8px] font-black tracking-widest bg-[#FF5A5F] text-white">AB</span>
              <span className="rounded px-1 py-px text-[8px] font-black tracking-widest bg-[#003580] text-white">BK</span>
              Outside booking (calendar sync)
            </div>
          )}
          {checkoutSet.size > 0 && (
            <p>Checkout days stay open so the next guest can check in the same day.</p>
          )}
        </div>
      )}

      <div className="flex justify-between items-center mt-4 pt-3.5 border-t border-ch-line gap-3 flex-wrap">
        <span className="text-[12.5px] text-ch-muted">{summary()}</span>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3.5 py-2 rounded-full border border-ch-line text-xs font-semibold text-ch-pine"
            onClick={() => onChange({ start: null, end: null })}
          >
            {t('common.clear')}
          </button>
          {!inline && (
            <button
              type="button"
              className="px-3.5 py-2 rounded-full bg-ch-pine text-white text-xs font-semibold hover:bg-ch-pine-dark"
              onClick={() => onClose?.()}
            >
              {t('common.apply')}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (inline) return panel;

  if (typeof document === 'undefined') return null;
  if (!isMobile && !pos) return null;

  return createPortal(
    <>
      {isMobile && (
        <div className="fixed inset-0 z-[219] bg-black/40 backdrop-blur-sm" onClick={() => onClose?.()} aria-hidden="true" />
      )}
      {panel}
    </>,
    document.body
  );
}

function Month({ month, value, onPick, blockedSet, checkoutSet, blockedSources, dailyPrices, minNights, localeTag, allowPastDates = false }) {
  const y = month.getFullYear();
  const mo = month.getMonth();
  const first = new Date(y, mo, 1);
  const last = new Date(y, mo + 1, 0);
  const startDay = (first.getDay() + 6) % 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthKey = `${y}-${String(mo + 1).padStart(2, '0')}-`;
  const hasAnyPrice = Object.keys(dailyPrices || {}).some((iso) => iso.startsWith(monthKey));

  const cells = [];
  for (let i = 0; i < startDay; i++) {
    cells.push(<span key={`b${i}`} className={hasAnyPrice ? 'min-h-[52px]' : 'invisible'} />);
  }

  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(y, mo, d);
    const iso = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const past = date < today;
    const pastLocked = past && !allowPastDates;
    const blocked = blockedSet.has(iso) && !checkoutSet?.has(iso);
    const otaLook = blocked ? otaBlockLook(blockedSources?.[iso]) : null;
    const turnoverOpen = checkoutSet?.has(iso) && !blocked;
    const violatesMin =
      !!minNights &&
      minNights > 0 &&
      !!value.start &&
      !value.end &&
      date > value.start &&
      Math.round((+date - +value.start) / 86_400_000) < minNights;

    const choosingCheckout = !!value.start && !value.end && date > value.start;
    let validCheckout = false;
    let checkoutOnly = false;
    if (choosingCheckout && value.start) {
      const crosses = rangeHasBlockedNight(value.start, date, blockedSet, checkoutSet);
      const nights = Math.round((+date - +value.start) / 86_400_000);
      validCheckout = !crosses && nights >= Math.max(1, minNights || 0);
      checkoutOnly = validCheckout && blocked;
    }

    const isStart = value.start && +date === +value.start;
    const isEnd = value.end && +date === +value.end;
    const between = value.start && value.end && date > value.start && date < value.end;
    const disabled = pastLocked || (choosingCheckout ? !validCheckout : blocked || violatesMin);
    const price = !disabled ? dailyPrices?.[iso] : undefined;

    let cls = hasAnyPrice
      ? 'min-h-[52px] flex flex-col items-center justify-center rounded-[10px] text-sm font-medium transition-colors px-0.5'
      : 'aspect-square grid place-items-center rounded-full text-sm font-medium transition-colors';

    if (pastLocked) cls += ' text-ch-muted/40 line-through cursor-not-allowed';
    else if (isStart || isEnd) cls += ' bg-ch-pine text-white font-bold cursor-pointer';
    else if (between) cls += ' bg-ch-pine-50 text-ch-pine rounded-none cursor-pointer';
    else if (choosingCheckout && validCheckout) {
      cls += checkoutOnly
        ? ' bg-[#eef4f3] text-ch-pine cursor-pointer ring-1 ring-inset ring-[#d7deea]'
        : ' hover:bg-ch-pine-50 cursor-pointer';
    } else if (otaLook) {
      cls += ` cursor-not-allowed ${otaLook.ringClass}`;
    } else if (blocked) cls += ' text-ch-muted/40 line-through bg-[#f4f5f7] cursor-not-allowed';
    else if (violatesMin) cls += ' text-ch-muted/40 bg-[#f7f8fa] cursor-not-allowed';
    else if (turnoverOpen) cls += ' hover:bg-ch-pine-50 cursor-pointer ring-1 ring-inset ring-emerald-200';
    else cls += ' hover:bg-ch-pine-50 cursor-pointer';

    if (isStart && !isEnd) cls += ' rounded-r-none';
    if (isEnd && !isStart) cls += ' rounded-l-none';

    cells.push(
      <button
        type="button"
        key={d}
        onClick={() => !disabled && onPick(date)}
        disabled={disabled}
        title={
          turnoverOpen
            ? 'Checkout day — free for the next check-in'
            : otaLook
              ? otaLook.label
              : blocked
                ? 'Unavailable — already booked'
                : undefined
        }
        className={cls}
        style={otaLook && !isStart && !isEnd ? { backgroundImage: otaLook.hatch } : undefined}
      >
        {otaLook && !isStart && !isEnd ? (
          <span className="flex flex-col items-center gap-0.5 leading-none">
            <span className={`rounded px-0.5 text-[8px] font-black tracking-widest ${otaLook.badgeClass}`}>{otaLook.badge}</span>
            <span className="text-[11px] font-bold text-slate-700">{d}</span>
          </span>
        ) : (
          <span>{d}</span>
        )}
        {price !== undefined && (
          <span
            className={`mt-0.5 text-[10px] leading-none font-normal ${
              isStart || isEnd ? 'text-white/85' : between ? 'text-ch-pine' : 'text-ch-muted'
            }`}
          >
            {compactPrice(price)}
          </span>
        )}
      </button>
    );
  }

  return (
    <div>
      <div className="text-center font-bold text-sm mb-2 text-ch-pine">
        {month.toLocaleDateString(localeTag || 'en-US', { month: 'long', year: 'numeric' })}
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[10.5px] font-bold text-ch-muted uppercase tracking-wider mb-1">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
          <span key={i} className="text-center py-1.5">{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">{cells}</div>
    </div>
  );
}

export function formatBookingDate(d, empty = 'Add date') {
  if (!d) return empty;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function isoToLocalDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function localDateToIso(d) {
  if (!d) return '';
  return dateToIso(d);
}
