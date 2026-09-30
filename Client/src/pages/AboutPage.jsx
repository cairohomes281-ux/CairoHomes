import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import PageHero from '../components/layout/PageHero';
import SectionIntro from '../components/ui/SectionIntro';
import Reveal from '../components/ui/Reveal';
import HostCta from '../components/home/HostCta';
import { useLocale } from '../context/LocaleContext';
import { CAIRO_IMAGES } from '../data/compounds';

const VALUE_KEYS = ['quality', 'teamwork', 'respect', 'integrity', 'responsibility', 'innovative'];

export default function AboutPage() {
  const { t } = useLocale();

  return (
    <div className="bg-ch-ivory">
      <Header />
      <PageHero
        eyebrow={t('about.eyebrow')}
        title={t('about.titleBefore')}
        titleEm={t('about.titleEm')}
        body={t('about.heroBody')}
        image={CAIRO_IMAGES.feluccas}
      >
        <div className="flex flex-wrap items-center gap-6">
          <Link to="/search" className="ch-btn">
            {t('home.findHome')}
            <ArrowUpRight size={16} className="rtl:-scale-x-100" />
          </Link>
          <Link to="/contact" className="ch-link">{t('about.contact')}</Link>
        </div>
      </PageHero>

      <section className="ch-section">
        <div className="ch-container grid gap-14 lg:grid-cols-[1fr_1fr] lg:gap-24">
          <SectionIntro eyebrow={t('about.storyEyebrow')} title={t('about.storyTitleBefore')} titleEm={t('about.storyTitleEm')} />
          <Reveal delay={120} className="space-y-6">
            <p className="font-display text-[1.45rem] leading-[1.55] text-ch-pine-dark md:text-[1.7rem]">{t('about.storyLead')}</p>
            <p className="ch-lede">{t('about.story1')}</p>
            <p className="ch-lede">{t('about.story2')}</p>
          </Reveal>
        </div>
      </section>

      <section className="overflow-hidden">
        <div className="ch-container grid gap-5 md:grid-cols-[1.3fr_0.7fr_1fr]">
          <Reveal mask className="aspect-[4/3] overflow-hidden rounded-[2rem] md:aspect-auto md:h-[30rem]">
            <img src={CAIRO_IMAGES.nile} alt="" loading="lazy" className="h-full w-full object-cover" />
          </Reveal>
          <Reveal mask delay={120} className="ch-arch hidden md:block md:h-[30rem]">
            <img src={CAIRO_IMAGES.reading} alt="" loading="lazy" className="h-full w-full object-cover" />
          </Reveal>
          <Reveal mask delay={240} className="aspect-[4/3] overflow-hidden rounded-[2rem] md:aspect-auto md:h-[30rem]">
            <img src={CAIRO_IMAGES.skyline} alt="" loading="lazy" className="h-full w-full object-cover" />
          </Reveal>
        </div>
      </section>

      <section className="ch-section">
        <div className="ch-container">
          <SectionIntro eyebrow={t('about.valuesEyebrow')} title={t('about.valuesTitle')} titleEm={t('about.valuesTitleEm')} />
          <div className="mt-14 grid gap-px overflow-hidden rounded-[2rem] border border-ch-line bg-ch-line sm:grid-cols-2 lg:grid-cols-3">
            {VALUE_KEYS.map((key, i) => (
              <Reveal key={key} delay={(i % 3) * 90} className="group bg-ch-ivory p-8 transition-colors duration-500 hover:bg-ch-rose/60 md:p-10">
                <span className="font-num text-[11px] tracking-[0.24em] text-ch-clay">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="mt-6 font-display text-[1.7rem] text-ch-pine-dark">{t(`about.${key}Title`)}</h3>
                <p className="mt-3 text-[14.5px] leading-[1.8] text-ch-muted">{t(`about.${key}Body`)}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <HostCta />
      <Footer />
    </div>
  );
}
