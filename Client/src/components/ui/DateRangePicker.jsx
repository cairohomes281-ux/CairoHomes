import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const isSameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const isBeforeDay = (a, b) => startOfDay(a).getTime() < startOfDay(b).getTime();
const isAfterDay = (a, b) => startOfDay(a).getTime() > startOfDay(b).getTime();
const addMonths = (date, offset) => new Date(date.getFullYear(), date.getMonth() + offset, 1);

const formatMonthLabel = (date, localeTag = 'en-US') =>
  date.toLocaleDateString(localeTag, { month: 'long', year: 'numeric' });

const toIsoLocal = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const formatStayDate = (value, empty, localeTag = 'en-US') => {
  const fallback = empty ?? 'Add date';
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString(localeTag, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

const buildCalendarDays = (monthDate) => {
  const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const startDate = new Date(firstDayOfMonth);
  startDate.setDate(firstDayOfMonth.getDate() - firstDayOfMonth.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const nextDate = new Date(startDate);
    nextDate.setDate(startDate.getDate() + index);
    return nextDate;
  });
};


export default function DateRangePicker({
  checkin = '',
  checkout = '',
  onChange,
  defaultOpen = false,
  variant = 'default',
  onOpenChange,
}) {
  const { t, localeTag } = useLocale();
  const rootRef = useRef(null);
  const popoverRef = useRef(null);
  const [open, setOpen] = useState(defaultOpen);
  const [activeField, setActiveField] = useState('arrive');
  const [popoverStyle, setPopoverStyle] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const seed = checkin || checkout;
    return seed ? new Date(`${seed}T00:00:00`) : new Date();
  });
  const isHero = variant === 'hero';

  useLayoutEffect(() => {
    if (!open) {
      setPopoverStyle(null);
      return undefined;
    }
    function place() {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.min(340, Math.max(rect.width, 280));
      let left = rect.left;
      if (left + width > window.innerWidth - 12) {
        left = Math.max(12, window.innerWidth - width - 12);
      }
      setPopoverStyle({
        position: 'fixed',
        top: rect.bottom + 12,
        left,
        width,
        zIndex: 400,
      });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, calendarMonth, checkin, checkout, activeField]);

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (event) => {
      const inRoot = rootRef.current?.contains(event.target);
      const inPopover = popoverRef.current?.contains(event.target);
      if (!inRoot && !inPopover) {
        setOpen(false);
        onOpenChange?.(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open, onOpenChange]);

  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);

  function setPickerOpen(next, field) {
    setOpen(next);
    onOpenChange?.(next);
    if (field) setActiveField(field);
  }

  function openPicker(field) {
    const selectedValue = field === 'arrive' ? checkin : checkout || checkin;
    const selectedDate = selectedValue ? new Date(`${selectedValue}T00:00:00`) : new Date();
    setActiveField(field);
    setPickerOpen(true, field);
    setCalendarMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }

  function handleSelect(date) {
    const today = startOfDay(new Date());
    if (isBeforeDay(date, today)) return;

    const value = toIsoLocal(date);

    if (activeField === 'arrive') {
      const departDate = checkout ? new Date(`${checkout}T00:00:00`) : null;
      const nextCheckout = departDate && isAfterDay(departDate, date) ? checkout : '';
      onChange?.({ checkin: value, checkout: nextCheckout });
      setActiveField('depart');
      setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      return;
    }

    if (!checkin) {
      onChange?.({ checkin: value, checkout: '' });
      setActiveField('depart');
      setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      return;
    }

    const arriveDate = new Date(`${checkin}T00:00:00`);
    if (isSameDay(date, arriveDate) || isBeforeDay(date, arriveDate)) {
      onChange?.({ checkin: value, checkout: '' });
      setActiveField('depart');
      setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      return;
    }

    onChange?.({ checkin, checkout: value });
    setPickerOpen(false);
  }

  function clearDates(e) {
    e.stopPropagation();
    onChange?.({ checkin: '', checkout: '' });
    setActiveField('arrive');
  }

  const today = startOfDay(new Date());
  const arriveDate = checkin ? new Date(`${checkin}T00:00:00`) : null;
  const departDate = checkout ? new Date(`${checkout}T00:00:00`) : null;

  const isCapsule = variant === 'capsule';
  const shellCls = isHero
    ? 'grid grid-cols-2 overflow-hidden rounded-2xl border border-white/25 bg-white/10'
    : isCapsule
      ? 'grid h-full grid-cols-2 overflow-hidden rounded-full'
      : 'grid grid-cols-2 overflow-hidden rounded-xl border border-ch-line bg-white';
  const labelCls = isHero
    ? 'block text-[11px] font-bold uppercase tracking-wider text-white/70'
    : isCapsule
      ? 'block text-[10px] font-semibold uppercase tracking-[0.22em] text-ch-clay'
      : 'block text-[10px] font-bold uppercase tracking-wider text-ch-muted';
  const valueCls = (filled) =>
    isHero
      ? `mt-0.5 block truncate text-sm font-medium ${filled ? 'text-white' : 'text-white/55'}`
      : `mt-0.5 block truncate text-sm font-medium ${filled ? 'text-ch-pine' : 'text-ch-muted'}`;
  const halfActive = (field) =>
    isHero
      ? open && activeField === field
        ? 'bg-white/20'
        : 'hover:bg-white/15'
      : open && activeField === field
        ? 'bg-ch-rose/70'
        : isCapsule
          ? 'hover:bg-ch-rose/40'
          : 'hover:bg-ch-pine-50/40';
  const popoverCls = isHero
    ? 'rounded-2xl border border-white/25 bg-white/95 p-4 shadow-2xl backdrop-blur-xl sm:p-6'
    : 'rounded-2xl border border-ch-line bg-white p-4 shadow-[0_18px_50px_rgba(47,93,88,0.18)]';

  const calendarPanel = open && popoverStyle ? (
    <div ref={popoverRef} className={popoverCls} style={popoverStyle}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="inline-flex rounded-full border border-ch-line bg-ch-ivory/50 p-0.5">
          <button
            type="button"
            onClick={() => setActiveField('arrive')}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
              activeField === 'arrive'
                ? 'bg-ch-pine text-white'
                : 'text-ch-muted hover:text-ch-pine'
            }`}
          >
            {isHero ? t('home.arrive') : t('common.from')}
          </button>
          <button
            type="button"
            onClick={() => setActiveField('depart')}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
              activeField === 'depart'
                ? 'bg-ch-pine text-white'
                : 'text-ch-muted hover:text-ch-pine'
            }`}
          >
            {isHero ? t('home.depart') : t('common.to')}
          </button>
        </div>
        {(checkin || checkout) && (
          <button
            type="button"
            onClick={clearDates}
            className="text-[11px] font-semibold text-ch-muted hover:text-ch-pine"
          >
            {t('common.clear')}
          </button>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between text-ch-pine">
        <button
          type="button"
          onClick={() => setCalendarMonth((c) => addMonths(c, -1))}
          className="rounded-full px-2 py-1 text-lg font-semibold transition-colors hover:bg-ch-pine-50"
          aria-label={t('common.previousMonth')}
        >
          ←
        </button>
        <span className="text-sm font-semibold uppercase tracking-[0.18em]">
          {formatMonthLabel(calendarMonth, localeTag)}
        </span>
        <button
          type="button"
          onClick={() => setCalendarMonth((c) => addMonths(c, 1))}
          className="rounded-full px-2 py-1 text-lg font-semibold transition-colors hover:bg-ch-pine-50"
          aria-label={t('common.nextMonth')}
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center font-medium">
        {WEEKDAYS.map((weekday) => (
          <span
            key={weekday}
            className="text-[10px] font-semibold tracking-[0.14em] text-ch-muted/70"
          >
            {weekday}
          </span>
        ))}

        {calendarDays.map((day) => {
          const inCurrentMonth = day.getMonth() === calendarMonth.getMonth();
          const isDisabled = isBeforeDay(day, today);
          const isSelectedStart = arriveDate && isSameDay(day, arriveDate);
          const isSelectedEnd = departDate && isSameDay(day, departDate);
          const isInRange =
            arriveDate &&
            departDate &&
            isAfterDay(day, arriveDate) &&
            isBeforeDay(day, departDate);

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={isDisabled}
              onClick={() => handleSelect(day)}
              className={[
                'mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[13px] transition-colors',
                isDisabled
                  ? 'cursor-not-allowed text-ch-muted/35'
                  : 'cursor-pointer text-ch-pine hover:bg-ch-pine-50',
                !inCurrentMonth ? 'opacity-35' : '',
                isInRange ? 'bg-ch-pine-50 text-ch-pine' : '',
                isSelectedStart || isSelectedEnd
                  ? 'bg-ch-pine font-bold text-white hover:bg-ch-pine'
                  : '',
              ].join(' ')}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={`relative z-10 ${isCapsule ? 'h-full' : ''}`}>
      <div className={shellCls}>
        <button
          type="button"
          onClick={() => openPicker('arrive')}
          className={`border-e ${isHero ? 'border-white/20' : 'border-ch-line'} ${isHero ? 'px-5 py-4' : isCapsule ? 'px-6 py-3' : 'px-3.5 py-2.5'} text-start transition ${halfActive('arrive')}`}
        >
          <span className={labelCls}>{isHero || isCapsule ? t('home.arrive') : t('common.from')}</span>
          <span className={valueCls(!!checkin)}>
            {formatStayDate(checkin, isHero || isCapsule ? t('common.selectDate') : t('common.addDate'), localeTag)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => openPicker('depart')}
          className={`${isHero ? 'px-5 py-4' : isCapsule ? 'px-6 py-3' : 'px-3.5 py-2.5'} text-start transition ${halfActive('depart')}`}
        >
          <span className={labelCls}>{isHero || isCapsule ? t('home.depart') : t('common.to')}</span>
          <span className={valueCls(!!checkout)}>
            {formatStayDate(checkout, isHero || isCapsule ? t('common.selectDate') : t('common.addDate'), localeTag)}
          </span>
        </button>
      </div>

      {calendarPanel && typeof document !== 'undefined'
        ? createPortal(calendarPanel, document.body)
        : null}
    </div>
  );
}

export function DateRangeFieldLabel() {
  const { t } = useLocale();
  return (
    <span className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-ch-muted">
      <CalendarDays size={13} strokeWidth={2} />
      {t('common.dates')}
    </span>
  );
}
