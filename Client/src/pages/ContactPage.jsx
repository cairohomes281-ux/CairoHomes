import { ArrowUpRight, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import PageHero from '../components/layout/PageHero';
import Reveal from '../components/ui/Reveal';
import { brand, whatsappHref } from '../theme/brand';
import { useLocale } from '../context/LocaleContext';
import { CAIRO_IMAGES } from '../data/compounds';

export default function ContactPage() {
  const { t } = useLocale();
  const channels = [
    {
      label: t('contact.whatsapp'),
      description: t('contact.whatsappDesc'),
      value: brand.phoneDisplay,
      href: whatsappHref(''),
      external: true,
      icon: MessageCircle,
    },
    {
      label: t('contact.phone'),
      description: t('contact.phoneDesc'),
      value: brand.phoneDisplay,
      href: `tel:${brand.phoneDisplay.replace(/\s/g, '')}`,
      icon: Phone,
    },
    {
      label: t('contact.email'),
      description: t('contact.emailDesc'),
      value: brand.email,
      href: `mailto:${brand.email}`,
      icon: Mail,
    },
    {
      label: t('contact.location'),
      description: t('contact.locationDesc'),
      value: brand.address,
      href: brand.mapsUrl,
      external: true,
      icon: MapPin,
    },
  ];

  return (
    <div className="bg-ch-ivory">
      <Header />
      <PageHero eyebrow={t('contact.eyebrow')} title={t('contact.title')} titleEm={t('contact.titleEm')} body={t('contact.subtitle')} image={CAIRO_IMAGES.panorama} />

      <section className="ch-section">
        <div className="ch-container grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <Reveal>
            <p className="ch-eyebrow text-ch-clay">{t('contact.channels')}</p>
            <h2 className="mt-5 font-display text-[2.2rem] leading-[1.1] text-ch-pine-dark md:text-[2.8rem]">{t('contact.choosePath')}</h2>
            <p className="ch-lede mt-5">{t('contact.channelsBody')}</p>
            <div className="mt-10 rounded-[1.75rem] bg-ch-pine p-8 text-ch-ivory">
              <p className="ch-eyebrow text-ch-blush">{t('contact.headOffice')}</p>
              <p className="mt-4 font-display text-[1.5rem] leading-snug">{brand.address}</p>
              <p className="mt-4 text-[14px] text-ch-ivory/70">{t('contact.hours')}</p>
            </div>
          </Reveal>

          <ul className="border-t border-ch-line">
            {channels.map(({ label, description, value, href, external, icon: Icon }, i) => (
              <Reveal as="li" key={label} delay={i * 80}>
                <a
                  href={href}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                  className="group grid grid-cols-[3.5rem_1fr_auto] items-center gap-5 border-b border-ch-line py-7 transition-colors hover:bg-ch-rose/40 sm:px-4"
                >
                  <span className="grid h-14 w-14 place-items-center rounded-full border border-ch-pine/20 text-ch-pine transition duration-500 group-hover:border-ch-pine group-hover:bg-ch-pine group-hover:text-ch-ivory">
                    <Icon size={20} strokeWidth={1.6} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.22em] text-ch-clay">{label}</span>
                    <span className="mt-1 block truncate font-display text-[1.35rem] text-ch-pine-dark md:text-[1.6rem]" dir={Icon === Phone || Icon === MessageCircle ? 'ltr' : undefined}>
                      {value}
                    </span>
                    <span className="mt-0.5 block text-[13.5px] text-ch-muted">{description}</span>
                  </span>
                  <ArrowUpRight size={20} className="text-ch-pine/30 transition group-hover:-translate-y-0.5 group-hover:text-ch-clay rtl:-scale-x-100" />
                </a>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>
      <Footer />
    </div>
  );
}
