import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Search, X } from 'lucide-react';
import { resolveLocationFilter, useProjectCatalog } from '../../hooks/useProjectCatalog';
import DateRangePicker from '../ui/DateRangePicker';
import { LogoMark } from '../brand/Logo';
import { useLocale } from '../../context/LocaleContext';

function parseIso(iso) {
  return iso || '';
}

export const RENTAL_TYPES = ['Apartment', 'Studio', 'Penthouse', 'Villa'];

const RENTAL_TYPE_KEYS = {
  Apartment: 'search.typeApartment',
  Studio: 'search.typeStudio',
  Villa: 'search.typeVilla',
  Penthouse: 'search.typePenthouse',
};

const STICKY_TOP = 92;

const budgetInputCls =
  'w-full border-0 border-b border-white/20 bg-transparent px-0 py-2 font-num text-[15px] text-ch-ivory outline-none transition placeholder:text-ch-ivory/35 focus:border-ch-blush focus:ring-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

function chipCls(active) {
  return `rounded-full border px-3 py-1 text-[12px] font-medium transition ${
    active
      ? 'border-ch-blush bg-ch-blush text-ch-pine-dark'
      : 'border-white/15 text-ch-ivory/80 hover:border-ch-blush/60 hover:text-ch-ivory'
  }`;
}

export default function PropertyFiltersSidebar({
  values,
  onApply,
  onClear,
  variant = 'sidebar',
  onClose,
  mode = 'rent',
}) {
  const { t } = useLocale();
  const isLongTerm = mode === 'long_term';
  const { destinations, projectsByDestination } = useProjectCatalog();
  const [destination, setDestination] = useState('');
  const [checkin, setCheckin] = useState('');
  const [checkout, setCheckout] = useState('');
  const [guests, setGuests] = useState(1);
  const [beds, setBeds] = useState(0);
  const [rentalTypes, setRentalTypes] = useState([]);
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(0);
  const priceTimer = useRef(null);
  const skipLive = useRef(true);
  const asideRef = useRef(null);
  const [fitsViewport, setFitsViewport] = useState(true);

  useEffect(() => {
    const el = asideRef.current;
    if (!el) return undefined;
    const measure = () => setFitsViewport(el.offsetHeight + STICKY_TOP + 16 <= window.innerHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    skipLive.current = true;
    const where = values.where || '';
    const resolved = resolveLocationFilter(where, { destinations, projectsByDestination });
    setDestination(values.destination || resolved.destination || '');
    setCheckin(parseIso(values.checkin));
    setCheckout(parseIso(values.checkout));
    setGuests(Math.max(1, Number(values.guests) || 1));
    setBeds(values.beds ? Number(values.beds) : 0);
    setRentalTypes(Array.isArray(values.types) ? values.types : []);
    setPriceMin(values.priceMin ? Number(values.priceMin) : 0);
    setPriceMax(values.priceMax ? Number(values.priceMax) : 0);
    const timer = window.setTimeout(() => {
      skipLive.current = false;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    values.where,
    values.destination,
    values.checkin,
    values.checkout,
    values.guests,
    values.beds,
    
    Array.isArray(values.types) ? values.types.join(',') : '',
    values.priceMin,
    values.priceMax,
    destinations,
    projectsByDestination,
  ]);

  useEffect(() => () => {
    if (priceTimer.current) window.clearTimeout(priceTimer.current);
  }, []);

  function payloadFrom(next = {}) {
    const d = next.destination !== undefined ? next.destination : destination;
    const p = next.project !== undefined ? next.project : (values.compound || values.project || '');
    const cin = next.checkin !== undefined ? next.checkin : checkin;
    const cout = next.checkout !== undefined ? next.checkout : checkout;
    const g = next.guests !== undefined ? next.guests : guests;
    const b = next.beds !== undefined ? next.beds : beds;
    const types = next.types !== undefined ? next.types : rentalTypes;
    const min = next.priceMin !== undefined ? next.priceMin : priceMin;
    const max = next.priceMax !== undefined ? next.priceMax : priceMax;
    const where = p || d;
    const resolved = resolveLocationFilter(where, { destinations, projectsByDestination });
    const base = {
      where,
      destination: d || resolved.destination,
      compound: d ? p : '',
      beds: b || undefined,
      types: types.length ? types : [],
      priceMin: min || undefined,
      priceMax: max || undefined,
    };
    return {
      ...base,
      checkin: cin || undefined,
      checkout: cout || undefined,
      ...(isLongTerm ? {} : { guests: g }),
    };
  }

  function liveApply(next = {}) {
    if (skipLive.current) return;
    onApply?.(payloadFrom(next));
  }

  function setDestinationLive(value) {
    setDestination(value);
    
    liveApply({ destination: value, project: '' });
  }

  function setDatesLive({ checkin: nextIn, checkout: nextOut }) {
    setCheckin(nextIn || '');
    setCheckout(nextOut || '');
    liveApply({ checkin: nextIn || '', checkout: nextOut || '' });
  }

  function setGuestsLive(value) {
    setGuests(value);
    liveApply({ guests: value });
  }

  function setBedsLive(value) {
    setBeds(value);
    liveApply({ beds: value });
  }

  function toggleRentalType(type) {
    const next = rentalTypes.includes(type)
      ? rentalTypes.filter((t2) => t2 !== type)
      : [...rentalTypes, type];
    setRentalTypes(next);
    liveApply({ types: next });
  }

  function setPriceRangeLive(nextMin, nextMax) {
    setPriceMin(nextMin);
    setPriceMax(nextMax);
    if (priceTimer.current) window.clearTimeout(priceTimer.current);
    priceTimer.current = window.setTimeout(() => {
      liveApply({ priceMin: nextMin, priceMax: nextMax });
    }, 350);
  }

  function clearAll() {
    if (priceTimer.current) window.clearTimeout(priceTimer.current);
    setDestination('');
    setCheckin('');
    setCheckout('');
    setGuests(1);
    setBeds(0);
    setRentalTypes([]);
    setPriceMin(0);
    setPriceMax(0);
    onClear?.();
    onClose?.();
  }

  const activeCount =
    (destination ? 1 : 0) +
    (checkin || checkout ? 1 : 0) +
    (!isLongTerm && guests > 1 ? 1 : 0) +
    (beds ? 1 : 0) +
    (rentalTypes.length ? 1 : 0) +
    (priceMin || priceMax ? 1 : 0);

  let step = 0;
  const nextStep = () => String((step += 1)).padStart(2, '0');

  const fields = (
    <>
      <Step n={nextStep()} label={t('search.destination')}>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chipCls(!destination)} onClick={() => setDestinationLive('')}>
            {t('search.anywhere')}
          </button>
          {destinations.map((d) => (
            <button key={d} type="button" className={chipCls(destination === d)} onClick={() => setDestinationLive(d)}>
              {d}
            </button>
          ))}
        </div>
      </Step>

      <Step n={nextStep()} label={t('common.dates')}>
        <DateRangePicker variant="hero" checkin={checkin} checkout={checkout} onChange={setDatesLive} />
      </Step>

      <div className={`grid gap-4 ${isLongTerm ? '' : 'grid-cols-2'}`}>
        {!isLongTerm && (
          <Step n={nextStep()} label={t('home.searchGuests')} compact>
            <Stepper
              value={guests}
              display={guests}
              min={1}
              max={16}
              onChange={setGuestsLive}
              decLabel={t('search.fewerGuests')}
              incLabel={t('search.moreGuests')}
            />
          </Step>
        )}
        <Step n={nextStep()} label={t('search.bedrooms')} compact>
          <Stepper
            value={beds}
            display={beds === 0 ? t('search.any') : beds === 5 ? '5+' : beds}
            min={0}
            max={5}
            onChange={setBedsLive}
            decLabel={t('search.fewerBedrooms')}
            incLabel={t('search.moreBedrooms')}
          />
        </Step>
      </div>

      <Step n={nextStep()} label={t('search.rentalType')}>
        <div className="flex flex-wrap gap-1.5">
          {RENTAL_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={rentalTypes.includes(type)}
              className={chipCls(rentalTypes.includes(type))}
              onClick={() => toggleRentalType(type)}
            >
              {t(RENTAL_TYPE_KEYS[type])}
            </button>
          ))}
        </div>
      </Step>

      <Step n={nextStep()} label={isLongTerm ? t('search.priceRangeMonth') : t('search.priceRangeNight')}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <input
            type="number"
            min={0}
            step={isLongTerm ? 5000 : 500}
            className={budgetInputCls}
            value={priceMin || ''}
            placeholder={t('search.min')}
            aria-label={t('search.min')}
            onChange={(e) => setPriceRangeLive(Number(e.target.value) || 0, priceMax)}
          />
          <span className="pb-2.5 font-display text-sm italic text-ch-blush/70">{t('common.to')}</span>
          <input
            type="number"
            min={0}
            step={isLongTerm ? 5000 : 500}
            className={budgetInputCls}
            value={priceMax || ''}
            placeholder={t('search.max')}
            aria-label={t('search.max')}
            onChange={(e) => setPriceRangeLive(priceMin, Number(e.target.value) || 0)}
          />
        </div>
        {(priceMin > 0 || priceMax > 0) && (
          <p className="mt-2 text-[11px] text-ch-ivory/55">
            {priceMin > 0 && priceMax > 0
              ? t('search.priceRangeBoth', { min: priceMin.toLocaleString(), max: priceMax.toLocaleString() })
              : priceMin > 0
                ? t('search.fromEgp', { amount: priceMin.toLocaleString() })
                : t('search.upToEgp', { amount: priceMax.toLocaleString() })}
          </p>
        )}
      </Step>
    </>
  );

  const activeLine = activeCount
    ? t('search.activeFilters', { count: activeCount })
    : t('search.resultsUpdate');

  if (variant === 'sheet') {
    return (
      <div className="ch-menu-in fixed inset-0 z-[210] flex flex-col bg-ch-pine-dark text-ch-ivory lg:hidden">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('search.closeFilters')}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/15"
          >
            <X size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-display text-xl font-light">{t('search.refineTitle')}</div>
            <div className="truncate text-xs text-ch-ivory/55">{activeLine}</div>
          </div>
          <button type="button" onClick={clearAll} className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ch-blush">
            {t('common.clear')}
          </button>
        </div>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-6 pb-28">{fields}</div>

        <div className="border-t border-white/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex w-full items-center justify-center rounded-full bg-ch-blush py-3.5 text-sm font-semibold uppercase tracking-[0.16em] text-ch-pine-dark"
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <aside
      ref={asideRef}
      className={`relative z-40 hidden self-start lg:block ${fitsViewport ? 'lg:sticky' : ''}`}
      style={fitsViewport ? { top: STICKY_TOP } : undefined}
    >
      <div className="rounded-t-[50%_88px] rounded-b-[2rem] bg-ch-pine-dark text-ch-ivory shadow-[0_40px_80px_-40px_rgba(16,33,31,0.55)]">
        <div className="relative px-6 pb-5 pt-6 text-center">
          <div className="pointer-events-none absolute inset-x-4 top-3 bottom-0 rounded-t-[50%_80px] border border-b-0 border-white/10" />
          <span className="relative mx-auto grid h-10 w-10 place-items-center rounded-full bg-ch-blush text-ch-pine-dark">
            <LogoMark className="h-5 w-auto" strokeWidth={4} title="" />
          </span>
          <h2 className="relative mt-2 font-display text-[1.4rem] font-light leading-tight">
            {t('search.refineTitle')}
          </h2>
          <p className="relative mt-1 flex items-center justify-center gap-2 text-[11px] text-ch-ivory/55">
            <span>{activeLine}</span>
            {activeCount ? (
              <button
                type="button"
                onClick={clearAll}
                className="font-semibold uppercase tracking-[0.18em] text-ch-blush underline decoration-ch-blush/40 underline-offset-4 transition hover:text-white"
              >
                {t('common.clear')}
              </button>
            ) : null}
          </p>
        </div>

        <div className="space-y-5 px-6 pb-6">{fields}</div>
      </div>
    </aside>
  );
}

function Step({ n, label, compact = false, children }) {
  return (
    <div className="min-w-0">
      <div className="mb-2.5 flex items-center gap-2.5">
        <span className="font-display text-[13px] italic text-ch-blush/75">{n}</span>
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-ch-ivory/60">{label}</span>
        {!compact && <span className="h-px flex-1 bg-white/10" />}
      </div>
      {children}
    </div>
  );
}

function Stepper({ value, display, min, max, onChange, decLabel, incLabel }) {
  const btn =
    'grid h-8 w-8 shrink-0 place-items-center rounded-full text-ch-ivory transition hover:bg-white/10 hover:text-ch-blush disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex items-center justify-between rounded-full border border-white/15 p-1">
      <button type="button" aria-label={decLabel} className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={14} />
      </button>
      <span className="font-display text-[1.15rem] font-light leading-none">{display}</span>
      <button type="button" aria-label={incLabel} className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus size={14} />
      </button>
    </div>
  );
}

export function MobileSearchPill({ values, onOpen, filterCount = 0, mode = 'rent' }) {
  const { t, localeTag } = useLocale();
  const isLongTerm = mode === 'long_term';
  const place = values.where || t('search.anywhere');
  const guests = Number(values.guests) || 1;
  const dateStr = useMemo(() => {
    if (!values.checkin || !values.checkout) {
      return isLongTerm ? t('search.longTerm') : t('search.anyDates');
    }
    try {
      const da = new Date(`${values.checkin}T00:00:00`);
      const db = new Date(`${values.checkout}T00:00:00`);
      const fmt = (d) => d.toLocaleDateString(localeTag, { month: 'short', day: 'numeric' });
      const nights = Math.max(1, Math.round((+db - +da) / 86400000));
      return t('listing.rangeSummary', { start: fmt(da), end: fmt(db), nights });
    } catch {
      return t('search.anyDates');
    }
  }, [values.checkin, values.checkout, isLongTerm, localeTag, t]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-full border border-ch-line bg-white px-4 py-3 text-start shadow-[0_10px_30px_-18px_rgba(16,33,31,0.35)]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ch-pine-50 text-ch-pine">
        <Search size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-bold text-ch-pine">
          {isLongTerm ? place : `${place} · ${t('home.guestsLower', { count: guests })}`}
        </div>
        <div className="truncate text-[12px] text-ch-muted">{dateStr}</div>
      </div>
      {filterCount > 0 && (
        <span className="rounded-full bg-ch-pine px-2 py-0.5 text-[11px] font-bold text-white">
          {filterCount}
        </span>
      )}
    </button>
  );
}

export function FloatingFilterSort({ filterCount, sort, sortLabels, onOpenFilters, onSort }) {
  const { t } = useLocale();
  const [sortOpen, setSortOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setSortOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} className="fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 lg:hidden">
      {sortOpen && (
        <div className="absolute bottom-[calc(100%+10px)] left-1/2 min-w-[210px] -translate-x-1/2 rounded-[1.25rem] border border-ch-line bg-ch-ivory p-1.5 shadow-[0_30px_70px_-30px_rgba(16,33,31,0.45)]">
          {Object.entries(sortLabels).map(([key, labelKey]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onSort(key);
                setSortOpen(false);
              }}
              className={`block w-full rounded-[10px] px-3.5 py-2.5 text-start text-sm font-medium ${
                sort === key ? 'bg-ch-pine-50 font-semibold text-ch-pine' : 'hover:bg-ch-pine-50/60'
              }`}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center overflow-hidden rounded-full bg-ch-pine text-sm font-bold text-white shadow-[0_12px_36px_-8px_rgba(47,93,88,0.55)]">
        <button type="button" onClick={onOpenFilters} className="inline-flex items-center gap-2 px-5 py-3.5">
          {t('search.filters')}{filterCount > 0 ? ` · ${filterCount}` : ''}
        </button>
        <span className="h-5 w-px bg-white/35" />
        <button type="button" onClick={() => setSortOpen((o) => !o)} className="inline-flex items-center gap-2 px-5 py-3.5">
          {t('search.sort')}
        </button>
      </div>
    </div>
  );
}
