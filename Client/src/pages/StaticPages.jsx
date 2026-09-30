import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import PageHero from '../components/layout/PageHero';
import CompoundGrid from '../components/home/CompoundGrid';
import Reveal from '../components/ui/Reveal';
import { useLocale } from '../context/LocaleContext';
import { whatsappHref } from '../theme/brand';
import { CAIRO_IMAGES } from '../data/compounds';

export default function StaticPage({ eyebrow, title, titleEm, body, children }) {
  return (
    <div className="bg-ch-ivory">
      <Header />
      <PageHero compact eyebrow={eyebrow} title={title} titleEm={titleEm} body={body} />
      <main className="ch-container ch-section">
        <div className="mx-auto max-w-3xl space-y-5 text-[15.5px] leading-[1.9] text-ch-ink/80">{children}</div>
      </main>
      <Footer />
    </div>
  );
}

export function CompoundsPage() {
  const { t } = useLocale();
  return (
    <div className="bg-ch-ivory">
      <Header />
      <PageHero eyebrow={t('compoundsPage.eyebrow')} title={t('compoundsPage.title')} titleEm={t('compoundsPage.titleEm')} body={t('compoundsPage.body')} image={CAIRO_IMAGES.skyline}>
        <Link to="/search" className="ch-btn">{t('home.searchStays')}</Link>
      </PageHero>
      <CompoundGrid />
      <Footer />
    </div>
  );
}

function FaqItem({ q, a, index }) {
  const [open, setOpen] = useState(index === 0);
  return (
    <Reveal as="li" delay={Math.min(index, 6) * 60} className="border-b border-ch-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center justify-between gap-6 py-6 text-start"
      >
        <span className="font-display text-[1.25rem] text-ch-pine-dark transition-colors group-hover:text-ch-clay md:text-[1.45rem]">{q}</span>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border border-ch-pine/20 text-ch-pine transition duration-500 ${open ? 'rotate-45 bg-ch-pine text-ch-ivory' : ''}`}>
          <Plus size={18} />
        </span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-500 ease-ch ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <p className="max-w-2xl pb-7 text-[15px] leading-[1.85] text-ch-muted">{a}</p>
        </div>
      </div>
    </Reveal>
  );
}

export function FaqPage() {
  const { t, tList } = useLocale();
  const items = tList('faq.items');
  return (
    <div className="bg-ch-ivory">
      <Header />
      <PageHero compact eyebrow={t('faq.eyebrow')} title={t('faq.title')} titleEm={t('faq.titleEm')} body={t('faq.body')} />
      <main className="ch-container ch-section grid gap-14 lg:grid-cols-[0.7fr_1.3fr] lg:gap-20">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="rounded-[1.75rem] bg-ch-pine p-8 text-ch-ivory">
            <p className="font-display text-[1.6rem] leading-snug">{t('faq.stillQuestions')}</p>
            <p className="mt-3 text-[14px] text-ch-ivory/70">{t('faq.stillBody')}</p>
            <a href={whatsappHref()} target="_blank" rel="noreferrer" className="ch-btn-blush mt-7">
              {t('nav.whatsappUs')}
            </a>
          </div>
        </aside>
        <ul className="border-t border-ch-line">
          {items.map((item, i) => (
            <FaqItem key={item.q} q={item.q} a={item.a} index={i} />
          ))}
        </ul>
      </main>
      <Footer />
    </div>
  );
}

export function LegalPage({ kind }) {
  const { t } = useLocale();
  const titles = {
    terms: t('legal.terms'),
    privacy: t('legal.privacy'),
    'refund-policy': t('legal.refund'),
  };
  const title = titles[kind] || t('legal.fallback');
  return (
    <StaticPage eyebrow={t('legal.eyebrow')} title={title}>
      <p>{t('legal.placeholder', { title })}</p>
    </StaticPage>
  );
}
