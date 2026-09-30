import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Minus, Plus, Search } from 'lucide-react';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';
import DateRangePicker from '../ui/DateRangePicker';
import { useLocale } from '../../context/LocaleContext';

const isAfterDay = (a, b) => {
  const sa = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const sb = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return sa > sb;
};

const segmentLabel = 'block text-[10px] font-semibold uppercase tracking-[0.22em] text-ch-clay';

export default function HeroSearch({ className = '' }) {
  const navigate = useNavigate();
  const { t } = useLocale();
  const { projectCards } = useProjectCatalog();
  const capsuleRef = useRef(null);

  const grouped = useMemo(() => {
    const seen = new Set();
    const map = new Map();
    for (const p of projectCards) {
      const key = String(p.name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const dest = p.destination || p.area || '';
      if (!map.has(dest)) map.set(dest, []);
      map.get(dest).push(p);
    }
    return [...map.entries()];
  }, [projectCards]);

  const [criteria, setCriteria] = useState({
    project: '',
    destination: '',
    checkin: '',
    checkout: '',
    guests: 2,
  });
  const [projectOpen, setProjectOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);

  useEffect(() => {
    const onOutside = (event) => {
      if (capsuleRef.current && !capsuleRef.current.contains(event.target)) {
        setProjectOpen(false);
        setGuestOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const hasValidRange =
    criteria.checkin &&
    criteria.checkout &&
    isAfterDay(new Date(`${criteria.checkout}T00:00:00`), new Date(`${criteria.checkin}T00:00:00`));

  function handleSubmit(event) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (criteria.destination) params.set('destination', criteria.destination);
    if (criteria.project && criteria.project !== criteria.destination) params.set('compound', criteria.project);
    if (criteria.checkin) params.set('checkin', criteria.checkin);
    if (criteria.checkout) params.set('checkout', criteria.checkout);
    if (criteria.guests > 0) params.set('guests', String(criteria.guests));
    navigate(`/search?${params.toString()}`);
  }

  const whereLabel = criteria.project || criteria.destination || t('home.whichProject');

  return (
    <form
      ref={capsuleRef}
      onSubmit={handleSubmit}
      className={`relative z-[60] grid w-full grid-cols-1 overflow-visible rounded-[1.75rem] bg-ch-ivory p-2 text-start shadow-[0_40px_90px_-40px_rgba(16,33,31,0.65)] ring-1 ring-ch-pine/10 lg:grid-cols-[1.1fr_1.5fr_0.9fr_auto] lg:items-stretch lg:rounded-full ${className}`}
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setProjectOpen((o) => !o);
            setGuestOpen(false);
          }}
          className={`flex h-full w-full items-center gap-3 rounded-[1.4rem] px-5 py-3 text-start transition lg:rounded-full lg:px-7 ${
            projectOpen ? 'bg-ch-rose/70' : 'hover:bg-ch-rose/40'
          }`}
        >
          <MapPin size={18} strokeWidth={1.6} className="shrink-0 text-ch-pine/60" />
          <span className="min-w-0">
            <span className={segmentLabel}>{t('home.project')}</span>
            <span className={`mt-0.5 block truncate text-sm font-medium ${criteria.project || criteria.destination ? 'text-ch-pine' : 'text-ch-muted'}`}>
              {whereLabel}
            </span>
          </span>
        </button>

        {projectOpen ? (
          <div className="ch-fade-up absolute start-0 top-full z-[130] mt-3 max-h-80 w-full overflow-y-auto rounded-[1.5rem] border border-ch-line bg-ch-ivory p-2 shadow-[0_30px_70px_-30px_rgba(16,33,31,0.45)] sm:w-[22rem]" style={{ animationDuration: '0.4s' }}>
            <button
              type="button"
              onClick={() => {
                setCriteria((c) => ({ ...c, project: '', destination: '' }));
                setProjectOpen(false);
              }}
              className="w-full rounded-2xl px-4 py-3 text-start text-sm font-medium text-ch-pine hover:bg-ch-rose/60"
            >
              {t('home.anyProject')}
            </button>
            {grouped.map(([destination, items]) => (
              <div key={destination || 'other'} className="mt-1">
                {destination ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCriteria((c) => ({ ...c, project: '', destination }));
                      setProjectOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-4 pb-1 pt-3 text-start text-[10px] font-semibold uppercase tracking-[0.22em] text-ch-clay hover:text-ch-pine"
                  >
                    {destination}
                    <span className="normal-case tracking-normal text-ch-muted">{t('home.allOf')}</span>
                  </button>
                ) : null}
                {items
                  .filter((p) => p.name !== destination)
                  .map((option) => (
                    <button
                      key={option.id || option.name}
                      type="button"
                      onClick={() => {
                        setCriteria((c) => ({ ...c, project: option.name, destination: option.destination || option.area || '' }));
                        setProjectOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-start text-sm text-ch-pine hover:bg-ch-rose/60"
                    >
                      <img src={option.image} alt="" className="ch-arch-sm h-9 w-7 shrink-0 object-cover" loading="lazy" />
                      <span className="truncate">{option.name}</span>
                    </button>
                  ))}
              </div>
            ))}
            {grouped.length === 0 ? <p className="px-4 py-3 text-sm text-ch-muted">{t('home.noProjects')}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="border-t border-ch-line lg:border-s lg:border-t-0">
        <DateRangePicker
          variant="capsule"
          checkin={criteria.checkin}
          checkout={criteria.checkout}
          onChange={({ checkin, checkout }) => setCriteria((c) => ({ ...c, checkin: checkin || '', checkout: checkout || '' }))}
          onOpenChange={(open) => {
            if (open) {
              setProjectOpen(false);
              setGuestOpen(false);
            }
          }}
        />
      </div>

      <div className="relative border-t border-ch-line lg:border-s lg:border-t-0">
        <button
          type="button"
          onClick={() => {
            setGuestOpen((o) => !o);
            setProjectOpen(false);
          }}
          className={`flex h-full w-full flex-col justify-center rounded-[1.4rem] px-6 py-3 text-start transition lg:rounded-full ${
            guestOpen ? 'bg-ch-rose/70' : 'hover:bg-ch-rose/40'
          }`}
        >
          <span className={segmentLabel}>{t('home.searchGuests')}</span>
          <span className="mt-0.5 block truncate text-sm font-medium text-ch-pine">{t('common.guestsCount', { count: criteria.guests })}</span>
        </button>

        {guestOpen ? (
          <div className="ch-fade-up absolute end-0 top-full z-[130] mt-3 w-full rounded-[1.5rem] border border-ch-line bg-ch-ivory p-5 shadow-[0_30px_70px_-30px_rgba(16,33,31,0.45)] sm:w-[300px]" style={{ animationDuration: '0.4s' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="font-display text-lg text-ch-pine-dark">{t('home.searchGuests')}</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="-"
                  onClick={() => setCriteria((c) => ({ ...c, guests: Math.max(1, c.guests - 1) }))}
                  className="grid h-9 w-9 place-items-center rounded-full border border-ch-line text-ch-pine transition hover:border-ch-pine hover:bg-ch-pine hover:text-white"
                >
                  <Minus size={15} />
                </button>
                <span className="w-6 text-center font-num text-base font-semibold text-ch-pine">{criteria.guests}</span>
                <button
                  type="button"
                  aria-label="+"
                  onClick={() => setCriteria((c) => ({ ...c, guests: Math.min(20, c.guests + 1) }))}
                  className="grid h-9 w-9 place-items-center rounded-full border border-ch-line text-ch-pine transition hover:border-ch-pine hover:bg-ch-pine hover:text-white"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={criteria.checkin && criteria.checkout ? !hasValidRange : false}
        className="mt-2 inline-flex items-center justify-center gap-2.5 rounded-[1.4rem] bg-ch-pine px-7 py-4 text-[12px] font-semibold uppercase tracking-[0.2em] text-ch-ivory transition duration-500 ease-ch hover:bg-ch-pine-dark disabled:cursor-not-allowed disabled:opacity-60 lg:mt-0 lg:rounded-full lg:px-8"
      >
        <Search size={17} strokeWidth={2} />
        <span className="lg:hidden xl:inline">{t('home.searchStays')}</span>
      </button>
    </form>
  );
}
