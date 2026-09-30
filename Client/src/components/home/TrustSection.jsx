import { useLocale } from '../../context/LocaleContext';
import { CAIRO_IMAGES } from '../../data/compounds';
import Reveal from '../ui/Reveal';

const PILLARS = [0, 1, 2, 3];

export default function TrustSection() {
  const { t } = useLocale();

  return (
    <section className="ch-grain relative overflow-hidden bg-ch-pine text-ch-ivory">
      <div className="ch-container ch-section grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-24">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Reveal>
            <p className="ch-eyebrow flex items-center gap-3 text-ch-blush">
              <span className="h-px w-8 bg-ch-blush/60" />
              {t('home.trustEyebrow')}
            </p>
            <h2 className="mt-5 font-display text-[2.4rem] leading-[1.05] md:text-[3.5rem]">
              {t('home.trustTitle')} <em className="font-light italic text-ch-blush">{t('home.trustTitleEm')}</em>
            </h2>
            <p className="mt-6 max-w-md text-[16px] font-light leading-[1.85] text-ch-ivory/75">{t('home.trustBody')}</p>
          </Reveal>
          <Reveal delay={150} mask className="mt-12 hidden lg:block">
            <div className="ch-arch aspect-[4/3.3] w-[78%]">
              <img src={CAIRO_IMAGES.lounge} alt="" loading="lazy" className="h-full w-full object-cover" />
            </div>
          </Reveal>
        </div>

        <ol className="divide-y divide-white/10 border-y border-white/10">
          {PILLARS.map((i) => (
            <Reveal as="li" key={i} delay={i * 80} className="group grid grid-cols-[4.5rem_1fr] gap-6 py-10 md:grid-cols-[6rem_1fr] md:py-12">
              <span className="ch-text-outline font-display text-[3.4rem] leading-none text-ch-blush/70 transition-colors duration-500 group-hover:text-ch-blush md:text-[4.5rem]">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div>
                <h3 className="font-display text-[1.6rem] leading-tight md:text-[1.9rem]">{t(`home.trust${i}Title`)}</h3>
                <p className="mt-3 max-w-lg text-[15px] font-light leading-[1.85] text-ch-ivory/70">{t(`home.trust${i}Body`)}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}
