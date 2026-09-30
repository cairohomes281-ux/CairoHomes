import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import HomeHero from '../components/home/HomeHero';
import HeroSearch from '../components/home/HeroSearch';
import CompoundGrid from '../components/home/CompoundGrid';
import TrustSection from '../components/home/TrustSection';
import ConciergeSection from '../components/home/ConciergeSection';
import HostCta from '../components/home/HostCta';
import ListingCard, { ListingCardSkeleton } from '../components/ListingCard';
import SectionIntro from '../components/ui/SectionIntro';
import Reveal from '../components/ui/Reveal';
import { LogoMark } from '../components/brand/Logo';
import api from '../api/http';
import { useLocale } from '../context/LocaleContext';
import { useProjectCatalog } from '../hooks/useProjectCatalog';
import { AREAS, CAIRO_IMAGES } from '../data/compounds';

function NeighbourhoodMarquee() {
  const { destinations } = useProjectCatalog();
  const names = destinations.length ? destinations : AREAS;
  const row = [...names, ...names];
  return (
    <div dir="ltr" className="overflow-hidden border-y border-ch-line bg-ch-rose/40 py-7" aria-hidden="true">
      <div className="ch-marquee items-center">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center">
            {row.map((name, i) => (
              <span key={`${copy}-${i}`} className="flex items-center">
                <span className={`px-8 font-display text-[2rem] leading-none md:text-[2.6rem] ${i % 2 ? 'italic text-ch-clay' : 'text-ch-pine-dark'}`}>
                  {name}
                </span>
                <LogoMark className="h-7 w-auto text-ch-pine/35" strokeWidth={4} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Intro() {
  const { t } = useLocale();
  const { destinations } = useProjectCatalog();
  const stats = [
    { value: String(destinations.length || AREAS.length), label: t('home.statNeighbourhoods') },
    { value: '24/7', label: t('home.statCare') },
    { value: '1', label: t('home.statContact') },
  ];
  return (
    <section className="ch-section">
      <div className="ch-container grid items-center gap-16 lg:grid-cols-[0.95fr_1.05fr] lg:gap-24">
        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <Reveal mask>
            <div className="ch-arch aspect-[4/5] w-[82%]">
              <img src={CAIRO_IMAGES.bedroom} alt={t('home.introImageAlt')} loading="lazy" className="h-full w-full object-cover" />
            </div>
          </Reveal>
          <Reveal delay={250} className="absolute -bottom-8 end-0 w-[46%]">
            <div className="aspect-square overflow-hidden rounded-full border-[6px] border-ch-ivory shadow-[0_30px_60px_-30px_rgba(16,33,31,0.5)]">
              <img src={CAIRO_IMAGES.panorama} alt="" loading="lazy" className="h-full w-full object-cover" />
            </div>
          </Reveal>
          <span className="absolute end-[8%] top-6 font-arabic-display text-[1.1rem] text-ch-clay [writing-mode:vertical-rl]">
            بيوت القاهرة
          </span>
        </div>

        <div>
          <SectionIntro eyebrow={t('home.introEyebrow')} title={t('home.introTitle')} titleEm={t('home.introTitleEm')} />
          <Reveal delay={120}>
            <p className="ch-lede mt-6 max-w-xl">{t('home.introBody')}</p>
            <p className="ch-lede mt-4 max-w-xl">{t('home.introBody2')}</p>
          </Reveal>
          <Reveal delay={220} className="mt-12 flex gap-4 border-t border-ch-line pt-8 sm:gap-6">
            {stats.map((s) => (
              <div key={s.label} className="flex-1">
                <p className="font-display text-[2.6rem] leading-none text-ch-pine md:text-[3.2rem]">{s.value}</p>
                <p className="mt-3 text-[11px] font-semibold uppercase leading-relaxed tracking-[0.12em] text-ch-muted sm:tracking-[0.18em]">{s.label}</p>
              </div>
            ))}
          </Reveal>
          <Reveal delay={300} className="mt-10">
            <Link to="/about" className="ch-link">{t('home.introLink')}</Link>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function FeaturedStays({ featured, loading }) {
  const { t, isRtl } = useLocale();
  const railRef = useRef(null);

  function scrollBy(dir) {
    const rail = railRef.current;
    if (!rail) return;
    const card = rail.firstElementChild;
    const step = (card?.offsetWidth || 320) + 28;
    rail.scrollBy({ left: dir * step * (isRtl ? -1 : 1), behavior: 'smooth' });
  }

  return (
    <section className="ch-section overflow-hidden bg-ch-rose/45">
      <div className="ch-container flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
        <SectionIntro eyebrow={t('home.collection')} title={t('home.featuredTitle')} titleEm={t('home.featuredTitleEm')} body={t('home.featuredBody')} />
        <div className="flex shrink-0 items-center gap-3">
          <button type="button" onClick={() => scrollBy(-1)} aria-label={t('common.previous')} className="grid h-12 w-12 place-items-center rounded-full border border-ch-pine/25 text-ch-pine transition hover:border-ch-pine hover:bg-ch-pine hover:text-ch-ivory">
            <ArrowLeft size={18} className="rtl:rotate-180" />
          </button>
          <button type="button" onClick={() => scrollBy(1)} aria-label={t('common.next')} className="grid h-12 w-12 place-items-center rounded-full border border-ch-pine/25 text-ch-pine transition hover:border-ch-pine hover:bg-ch-pine hover:text-ch-ivory">
            <ArrowRight size={18} className="rtl:rotate-180" />
          </button>
        </div>
      </div>

      <div
        ref={railRef}
        className="ch-scroll-x mt-14 gap-7 scroll-px-5 px-5 pb-2 sm:scroll-px-8 sm:px-8 lg:scroll-px-[max(3rem,calc((100vw-1320px)/2+3rem))] lg:px-[max(3rem,calc((100vw-1320px)/2+3rem))]"
      >
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-[78vw] shrink-0 snap-start sm:w-[320px]">
              <ListingCardSkeleton variant="arch" />
            </div>
          ))}
        {!loading &&
          featured.map((u, i) => (
            <Reveal key={u.id} delay={Math.min(i, 4) * 90} className="w-[78vw] shrink-0 snap-start sm:w-[320px]">
              <ListingCard listing={u} priority={i < 3} variant="arch" />
            </Reveal>
          ))}
        {!loading && !featured.length && (
          <div className="ch-container">
            <p className="rounded-[1.5rem] border border-dashed border-ch-pine/25 px-6 py-10 text-center text-ch-muted">{t('home.featuredEmpty')}</p>
          </div>
        )}
      </div>

      <div className="ch-container mt-12">
        <Link to="/search" className="ch-link">{t('home.viewAll')}</Link>
      </div>
    </section>
  );
}

function WaysToStay() {
  const { t } = useLocale();
  const ways = [
    { to: '/search', image: CAIRO_IMAGES.suite, key: 'short' },
    { to: '/long-term', image: CAIRO_IMAGES.apartment, key: 'monthly' },
  ];
  return (
    <section className="ch-section pt-0">
      <div className="ch-container">
        <SectionIntro align="center" eyebrow={t('home.waysEyebrow')} title={t('home.waysTitle')} titleEm={t('home.waysTitleEm')} />
        <div className="mt-14 grid gap-6 md:grid-cols-2">
          {ways.map((w, i) => (
            <Reveal key={w.key} delay={i * 120}>
              <Link to={w.to} className="group relative block aspect-[4/3.1] overflow-hidden rounded-[2rem] text-ch-ivory">
                <img src={w.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-[1.6s] ease-ch group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-ch-ink/80 via-ch-ink/20 to-transparent" />
                <div className="absolute inset-x-7 bottom-7 flex items-end justify-between gap-6 md:inset-x-10 md:bottom-10">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ch-blush">{t(`home.ways_${w.key}_eyebrow`)}</p>
                    <h3 className="mt-2 font-display text-[2rem] leading-tight md:text-[2.6rem]">{t(`home.ways_${w.key}_title`)}</h3>
                    <p className="mt-2 max-w-sm text-[14px] text-ch-ivory/75">{t(`home.ways_${w.key}_body`)}</p>
                  </div>
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-white/40 transition duration-500 group-hover:border-ch-blush group-hover:bg-ch-blush group-hover:text-ch-pine-dark">
                    <ArrowUpRight size={20} className="rtl:-scale-x-100" />
                  </span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const [featured, setFeatured] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api
      .get('/units', { params: { featured: 'true', status: 'published', limit: 8 } })
      .then(async (featRes) => {
        if (cancelled) return;
        let items = featRes.data.items || [];
        if (!items.length) {
          const fallback = await api.get('/units', { params: { status: 'published', limit: 8 } });
          if (cancelled) return;
          items = fallback.data.items || [];
        }
        setFeatured(items);
      })
      .catch(() => {
        if (!cancelled) setFeatured([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-ch-ivory">
      <Header overHero />
      <HomeHero />

      <div id="home-search" className="ch-container relative z-30 -mt-12 scroll-mt-28 lg:-mt-11">
        <div className="ch-fade-up mx-auto max-w-5xl" style={{ animationDelay: '0.8s' }}>
          <HeroSearch />
        </div>
      </div>

      <div className="mt-16 md:mt-20">
        <NeighbourhoodMarquee />
      </div>
      <Intro />
      <CompoundGrid />
      <FeaturedStays featured={featured} loading={loading} />
      <TrustSection />
      <ConciergeSection />
      <WaysToStay />
      <HostCta />
      <Footer />
    </div>
  );
}
