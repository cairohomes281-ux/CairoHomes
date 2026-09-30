import { ArrowUpRight } from 'lucide-react';
import { useLocale } from '../../context/LocaleContext';
import { whatsappHref } from '../../theme/brand';
import { CAIRO_IMAGES } from '../../data/compounds';
import SectionIntro from '../ui/SectionIntro';
import Reveal from '../ui/Reveal';

const EXPERIENCES = [0, 1, 2, 3, 4];

export default function ConciergeSection() {
  const { t } = useLocale();

  return (
    <section className="ch-section">
      <div className="ch-container grid items-center gap-14 lg:grid-cols-2 lg:gap-20">
        <div className="relative order-2 lg:order-1">
          <Reveal mask className="relative">
            <div className="aspect-[4/5] overflow-hidden rounded-[2rem]">
              <img src={CAIRO_IMAGES.pyramidsDusk} alt={t('home.conciergeImageAlt')} loading="lazy" className="h-full w-full object-cover" />
            </div>
          </Reveal>
          <Reveal delay={250} className="absolute -bottom-10 end-4 w-[44%] sm:end-[-2rem]">
            <div className="ch-arch aspect-[3/4] border-[6px] border-ch-ivory shadow-[0_30px_60px_-30px_rgba(16,33,31,0.5)]">
              <img src={CAIRO_IMAGES.kitchen} alt="" loading="lazy" className="h-full w-full object-cover" />
            </div>
          </Reveal>
          <div aria-hidden="true" className="absolute -start-6 -top-6 -z-10 h-32 w-32 rounded-full bg-ch-blush/70" />
        </div>

        <div className="order-1 lg:order-2">
          <SectionIntro
            eyebrow={t('home.conciergeEyebrow')}
            title={t('home.conciergeTitle')}
            titleEm={t('home.conciergeTitleEm')}
            body={t('home.conciergeBody')}
          />
          <ul className="mt-10 border-t border-ch-line">
            {EXPERIENCES.map((i) => (
              <Reveal as="li" key={i} delay={i * 70} className="group flex items-center justify-between gap-6 border-b border-ch-line py-5">
                <div className="flex items-baseline gap-5">
                  <span className="font-num text-[11px] tracking-[0.2em] text-ch-clay">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <p className="font-display text-[1.35rem] text-ch-pine-dark transition-colors group-hover:text-ch-clay">{t(`home.concierge${i}`)}</p>
                    <p className="mt-0.5 text-[13.5px] text-ch-muted">{t(`home.concierge${i}Body`)}</p>
                  </div>
                </div>
                <ArrowUpRight size={18} className="shrink-0 text-ch-pine/30 transition group-hover:-translate-y-0.5 group-hover:text-ch-clay rtl:-scale-x-100" />
              </Reveal>
            ))}
          </ul>
          <Reveal delay={200} className="mt-10">
            <a href={whatsappHref(t('home.conciergeWhatsapp'))} target="_blank" rel="noreferrer" className="ch-btn">
              {t('home.conciergeCta')}
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
