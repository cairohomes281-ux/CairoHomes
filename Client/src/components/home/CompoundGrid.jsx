import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';
import { useLocale } from '../../context/LocaleContext';
import { CAIRO_IMAGES } from '../../data/compounds';
import SectionIntro from '../ui/SectionIntro';
import Reveal from '../ui/Reveal';

export default function CompoundGrid() {
  const { t, isRtl } = useLocale();
  const { projectCards, loading } = useProjectCatalog();
  const railRef = useRef(null);

  function scrollBy(dir) {
    const rail = railRef.current;
    if (!rail) return;
    const card = rail.querySelector('[data-card]');
    const step = (card?.offsetWidth || 320) + 24;
    rail.scrollBy({ left: dir * step * (isRtl ? -1 : 1), behavior: 'smooth' });
  }

  return (
    <section className="ch-section overflow-hidden">
      <div className="ch-container">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <SectionIntro eyebrow={t('home.neighbourhoodsEyebrow')} title={t('home.neighbourhoodsTitle')} titleEm={t('home.neighbourhoodsTitleEm')} body={t('home.neighbourhoodsBody')} />
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              aria-label={t('common.previous')}
              className="grid h-12 w-12 place-items-center rounded-full border border-ch-pine/25 text-ch-pine transition hover:border-ch-pine hover:bg-ch-pine hover:text-ch-ivory"
            >
              <ArrowLeft size={18} className="rtl:rotate-180" />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              aria-label={t('common.next')}
              className="grid h-12 w-12 place-items-center rounded-full border border-ch-pine/25 text-ch-pine transition hover:border-ch-pine hover:bg-ch-pine hover:text-ch-ivory"
            >
              <ArrowRight size={18} className="rtl:rotate-180" />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={railRef}
        className="ch-scroll-x mt-14 gap-6 scroll-px-5 px-5 pb-4 sm:scroll-px-8 sm:px-8 lg:scroll-px-[max(3rem,calc((100vw-1320px)/2+3rem))] lg:px-[max(3rem,calc((100vw-1320px)/2+3rem))]"
      >
        {(loading ? Array.from({ length: 5 }) : projectCards).map((p, i) => (
          <Reveal
            key={p?.id || i}
            delay={Math.min(i, 5) * 90}
            data-card
            className="w-[72vw] shrink-0 snap-start sm:w-[300px] lg:w-[320px]"
          >
            {p ? (
              <Link
                to={`/search?destination=${encodeURIComponent(p.destination)}${p.name !== p.destination ? `&compound=${encodeURIComponent(p.name)}` : ''}`}
                className="group block"
              >
                <div className={`ch-arch relative aspect-[3/4.2] bg-ch-sand ${i % 2 ? 'lg:mt-14' : ''}`}>
                  <img
                    src={p.image || CAIRO_IMAGES.apartment}
                    alt={p.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition duration-[1.6s] ease-ch group-hover:scale-[1.07]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-ch-ink/70 via-ch-ink/5 to-transparent" />
                  <span className="absolute start-1/2 top-[14%] -translate-x-1/2 font-num text-[11px] tracking-[0.3em] text-ch-ivory/80 rtl:translate-x-1/2">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="absolute inset-x-6 bottom-6 flex items-end justify-between gap-3 text-ch-ivory">
                    <div className="min-w-0">
                      {p.destination && p.destination !== p.name ? (
                        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ch-blush">{p.destination}</p>
                      ) : null}
                      <h3 className="mt-1 truncate font-display text-[1.75rem] leading-tight">{p.name}</h3>
                    </div>
                    <span className="grid h-11 w-11 shrink-0 translate-y-2 place-items-center rounded-full bg-ch-blush text-ch-pine-dark opacity-0 transition duration-500 ease-ch group-hover:translate-y-0 group-hover:opacity-100">
                      <ArrowUpRight size={18} className="rtl:-scale-x-100" />
                    </span>
                  </div>
                </div>
              </Link>
            ) : (
              <div className={`ch-arch aspect-[3/4.2] animate-pulse bg-ch-sand ${i % 2 ? 'lg:mt-14' : ''}`} />
            )}
          </Reveal>
        ))}
      </div>
    </section>
  );
}
