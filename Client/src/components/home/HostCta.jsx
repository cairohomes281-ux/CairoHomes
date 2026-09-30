import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { CAIRO_IMAGES } from '../../data/compounds';
import Reveal from '../ui/Reveal';

export default function HostCta() {
  const { t } = useLocale();

  return (
    <section className="ch-container">
      <div className="relative isolate overflow-hidden rounded-[2.25rem] bg-ch-pine-dark text-ch-ivory">
        <img src={CAIRO_IMAGES.terrace} alt="" loading="lazy" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-60" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ch-pine-dark via-ch-pine-dark/80 to-ch-pine-dark/10 rtl:bg-gradient-to-l" />

        <div className="grid gap-12 px-7 py-16 sm:px-12 md:py-24 lg:grid-cols-[1.2fr_0.8fr] lg:px-20">
          <Reveal>
            <p className="ch-eyebrow flex items-center gap-3 text-ch-blush">
              <span className="h-px w-8 bg-ch-blush/60" />
              {t('home.hostEyebrow')}
            </p>
            <h2 className="mt-5 max-w-xl font-display text-[2.4rem] leading-[1.05] md:text-[3.6rem]">
              {t('home.hostTitle')} <em className="font-light italic text-ch-blush">{t('home.hostTitleEm')}</em>
            </h2>
            <p className="mt-6 max-w-lg text-[16px] font-light leading-[1.85] text-ch-ivory/80">{t('home.hostBody')}</p>
            <div className="mt-10 flex flex-wrap items-center gap-6">
              <Link to="/owners" className="ch-btn-blush">
                {t('home.hostCta')}
                <ArrowUpRight size={16} className="rtl:-scale-x-100" />
              </Link>
              <Link to="/contact" className="ch-link ch-link--light">
                {t('home.hostSecondary')}
              </Link>
            </div>
          </Reveal>

          <Reveal delay={200} className="self-end">
            <ul className="space-y-px overflow-hidden rounded-[1.5rem] bg-white/10 backdrop-blur-md">
              {[0, 1, 2].map((i) => (
                <li key={i} className="bg-ch-pine-dark/40 px-6 py-5">
                  <p className="font-display text-[1.25rem] text-ch-blush">{t(`home.hostPoint${i}`)}</p>
                  <p className="mt-1 text-[13.5px] text-ch-ivory/70">{t(`home.hostPoint${i}Body`)}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
