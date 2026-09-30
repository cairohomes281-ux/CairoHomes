import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { CAIRO_IMAGES } from '../../data/compounds';
import { LogoMark } from '../brand/Logo';

const SLIDES = [
  { src: CAIRO_IMAGES.nile, captionKey: 'home.heroSlide0' },
  { src: CAIRO_IMAGES.livingRoom, captionKey: 'home.heroSlide1' },
  { src: CAIRO_IMAGES.feluccas, captionKey: 'home.heroSlide2' },
  { src: CAIRO_IMAGES.suite, captionKey: 'home.heroSlide3' },
  { src: CAIRO_IMAGES.skyline, captionKey: 'home.heroSlide4' },
];

export default function HomeHero() {
  const { t, isRtl } = useLocale();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 6500);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="ch-grain relative isolate overflow-hidden bg-ch-pine-dark text-ch-ivory">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 55% at 78% 38%, rgba(233,207,194,0.22) 0%, transparent 60%), radial-gradient(45% 50% at 8% 92%, rgba(181,114,90,0.18) 0%, transparent 70%)',
        }}
      />
      <LogoMark
        className="pointer-events-none absolute -start-24 top-24 -z-10 hidden h-[34rem] w-auto text-ch-blush/[0.05] lg:block"
        strokeWidth={1.2}
      />

      <div className="ch-container grid min-h-[100svh] items-center gap-12 pb-32 pt-32 lg:grid-cols-[1.08fr_0.92fr] lg:gap-10 lg:pb-40 lg:pt-36">
        <div className="relative z-10 max-w-2xl">
          <p className="ch-eyebrow ch-fade-up flex items-center gap-3 text-ch-blush/85" style={{ animationDelay: '0.15s' }}>
            <span className="h-px w-10 bg-ch-blush/50" />
            {t('home.heroEyebrow')}
          </p>
          <h1
            className={`ch-fade-up mt-7 font-display font-light ${isRtl ? 'leading-[1.2]' : 'leading-[0.92] tracking-[-0.02em]'}`}
            style={{ fontSize: isRtl ? 'clamp(2.6rem, 6vw, 5.4rem)' : 'clamp(3.2rem, 8.4vw, 7.6rem)', animationDelay: '0.3s' }}
          >
            {t('home.heroTitleLight')}
            <br />
            <em className="font-normal italic text-ch-blush">{t('home.heroTitleEm')}</em>
          </h1>
          <p className="ch-fade-up mt-8 max-w-lg text-[16px] font-light leading-[1.85] text-ch-ivory/75 md:text-[17.5px]" style={{ animationDelay: '0.5s' }}>
            {t('home.heroSubtitle')}
          </p>
          <div className="ch-fade-up mt-10 flex flex-wrap items-center gap-x-8 gap-y-4" style={{ animationDelay: '0.65s' }}>
            <Link to="/search" className="ch-btn-blush">
              {t('home.findHome')}
              <ArrowUpRight size={16} className="rtl:-scale-x-100" />
            </Link>
            <Link to="/long-term" className="ch-link ch-link--light">
              {t('home.monthlyLink')}
            </Link>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[26rem] lg:max-w-[30rem]">
          <div
            aria-hidden="true"
            className="ch-sun-rise absolute -end-6 -top-8 h-40 w-40 rounded-full bg-ch-blush/90 blur-[1px] sm:h-52 sm:w-52 lg:-end-14 lg:-top-10"
            style={{ animationDelay: '0.4s' }}
          />
          <div className="ch-arch-outline ch-arch-outline--light relative">
            <div className="ch-arch ch-fade-in relative aspect-[4/5.2] bg-ch-pine shadow-[0_60px_120px_-50px_rgba(0,0,0,0.7)]" style={{ animationDelay: '0.2s' }}>
              {SLIDES.map((s, i) => (
                <img
                  key={s.src}
                  src={s.src}
                  alt=""
                  fetchPriority={i === 0 ? 'high' : 'low'}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                  className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1600ms] ${
                    i === index ? 'ch-kenburns opacity-100' : 'opacity-0'
                  }`}
                />
              ))}
              <div className="absolute inset-0 bg-gradient-to-t from-ch-ink/55 via-transparent to-transparent" />
              <div className="absolute inset-x-6 bottom-6 flex items-end justify-between gap-4">
                <p key={index} className="ch-fade-up font-display text-[1.15rem] italic text-ch-ivory" style={{ animationDuration: '0.9s' }}>
                  {t(SLIDES[index].captionKey)}
                </p>
                <span className="font-num text-[11px] tracking-[0.2em] text-ch-ivory/70">
                  {String(index + 1).padStart(2, '0')} / {String(SLIDES.length).padStart(2, '0')}
                </span>
              </div>
            </div>
          </div>
          <div className="absolute -bottom-5 start-1/2 flex -translate-x-1/2 gap-2 rtl:translate-x-1/2">
            {SLIDES.map((s, i) => (
              <button
                key={s.src}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t(s.captionKey)}
                className={`h-1.5 rounded-full transition-all duration-500 ${i === index ? 'w-8 bg-ch-blush' : 'w-1.5 bg-ch-ivory/35 hover:bg-ch-ivory/60'}`}
              />
            ))}
          </div>
        </div>
      </div>

      <a
        href="#home-search"
        className="absolute bottom-28 start-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-ch-ivory/55 lg:flex rtl:translate-x-1/2"
      >
        <ArrowDown size={16} className="animate-bounce" />
      </a>
    </section>
  );
}
