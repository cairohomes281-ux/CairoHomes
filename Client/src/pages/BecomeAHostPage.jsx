import { useMemo, useState } from 'react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import PageHero from '../components/layout/PageHero';
import Reveal from '../components/ui/Reveal';
import api from '../api/http';
import { useProjectCatalog } from '../hooks/useProjectCatalog';
import { AREAS, CAIRO_IMAGES } from '../data/compounds';
import { UNIT_TYPES } from '../admin/utils/formatters';
import { useLocale } from '../context/LocaleContext';

const FURNISHING_OPTIONS = [
  { value: 'Fully Furnished', key: 'fullyFurnished' },
  { value: 'Semi Furnished', key: 'semiFurnished' },
  { value: 'Unfurnished', key: 'unfurnished' },
  { value: 'Negotiable', key: 'negotiable' },
];

const CONTACT_TIMES = [
  { value: 'Morning (9am–12pm)', key: 'morning' },
  { value: 'Afternoon (12pm–5pm)', key: 'afternoon' },
  { value: 'Evening (5pm–9pm)', key: 'evening' },
  { value: 'Anytime', key: 'anytime' },
];

const COUNTRY_CODES = [
  { code: '+20', label: 'Egypt (+20)' },
  { code: '+966', label: 'Saudi Arabia (+966)' },
  { code: '+971', label: 'UAE (+971)' },
  { code: '+974', label: 'Qatar (+974)' },
  { code: '+965', label: 'Kuwait (+965)' },
  { code: '+973', label: 'Bahrain (+973)' },
  { code: '+968', label: 'Oman (+968)' },
  { code: '+962', label: 'Jordan (+962)' },
  { code: '+961', label: 'Lebanon (+961)' },
  { code: '+212', label: 'Morocco (+212)' },
  { code: '+1', label: 'USA / Canada (+1)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+33', label: 'France (+33)' },
  { code: '+49', label: 'Germany (+49)' },
];

const EMPTY = {
  fullName: '',
  email: '',
  countryCode: '+20',
  phone: '',
  destination: '',
  project: '',
  furnishingStatus: '',
  propertyType: '',
  preferredContactTime: '',
};

const fieldClass = 'ch-input text-sm normal-case tracking-normal';

export default function BecomeAHostPage() {
  const { t } = useLocale();
  const { destinations, projectsByDestination } = useProjectCatalog();
  const destinationOptions = destinations?.length ? destinations : AREAS;

  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  const projectOptions = useMemo(() => {
    if (!form.destination || form.destination === 'Other') return [];
    return projectsByDestination?.[form.destination] || [];
  }, [form.destination, projectsByDestination]);

  const setField = (key) => (e) => {
    const value = e.target.value;
    setForm((f) => {
      if (key === 'destination') {
        return { ...f, destination: value, project: '' };
      }
      return { ...f, [key]: value };
    });
    setStatus(null);
  };

  const canSubmit = useMemo(
    () =>
      Boolean(
        form.fullName.trim() &&
          form.email.trim() &&
          form.phone.trim() &&
          form.destination &&
          form.project &&
          form.furnishingStatus &&
          form.propertyType &&
          form.preferredContactTime
      ),
    [form]
  );

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setStatus(null);
    try {
      await api.post('/host-requests', {
        full_name: form.fullName.trim(),
        email: form.email.trim(),
        country_code: form.countryCode,
        phone: form.phone.trim(),
        destination: form.destination,
        project: form.project,
        furnishing_status: form.furnishingStatus,
        property_type: form.propertyType,
        preferred_contact_time: form.preferredContactTime,
      });
      setForm({ ...EMPTY, countryCode: form.countryCode });
      setStatus({
        type: 'success',
        message: t('owners.success'),
      });
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.response?.data?.error || err.message || t('owners.error'),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-ch-ivory">
      <Header />
      <main>
        <PageHero
          eyebrow={t('owners.eyebrow')}
          title={t('owners.title')}
          titleEm={t('owners.titleEm')}
          body={t('owners.subtitle')}
          image={CAIRO_IMAGES.lounge}
        >
          <a href="#host-form" className="ch-btn">{t('owners.formTitle')}</a>
        </PageHero>

        <section className="ch-container ch-section">
          <div className="grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <Reveal>
                <p className="ch-eyebrow text-ch-clay">{t('owners.howEyebrow')}</p>
                <h2 className="mt-5 font-display text-[2.2rem] leading-[1.1] text-ch-pine-dark md:text-[2.8rem]">
                  {t('owners.howTitle')}
                </h2>
                <p className="ch-lede mt-5">{t('owners.formBody')}</p>
              </Reveal>
              <ol className="mt-10 border-t border-ch-line">
                {[0, 1, 2].map((i) => (
                  <Reveal as="li" key={i} delay={i * 90} className="grid grid-cols-[3.5rem_1fr] gap-4 border-b border-ch-line py-6">
                    <span className="ch-text-outline font-display text-[2.6rem] leading-none text-ch-clay">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <p className="font-display text-[1.3rem] text-ch-pine-dark">{t(`owners.step${i}Title`)}</p>
                      <p className="mt-1 text-[14px] leading-relaxed text-ch-muted">{t(`owners.bullet${i}`)}</p>
                    </div>
                  </Reveal>
                ))}
              </ol>
            </div>

            <form
              id="host-form"
              onSubmit={handleSubmit}
              className="scroll-mt-28 rounded-[2rem] border border-ch-line bg-white p-6 shadow-[0_40px_80px_-50px_rgba(16,33,31,0.45)] sm:p-10"
            >
              <p className="font-display text-[1.8rem] text-ch-pine-dark">{t('owners.formTitle')}</p>
              <p className="mb-8 mt-2 text-[14px] text-ch-muted">{t('owners.formHint')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ch-clay sm:col-span-2">
                  {t('owners.fullName')}
                  <input
                    type="text"
                    autoComplete="name"
                    value={form.fullName}
                    onChange={setField('fullName')}
                    className={fieldClass}
                    required
                  />
                </label>

                <label className="grid gap-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ch-clay sm:col-span-2">
                  {t('owners.email')}
                  <input
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={setField('email')}
                    className={fieldClass}
                    required
                  />
                </label>

                <div className="sm:col-span-2">
                  <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ch-clay">
                    {t('owners.phone')}
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <label className="sr-only" htmlFor="host-country-code">
                      {t('owners.countryCode')}
                    </label>
                    <select
                      id="host-country-code"
                      value={form.countryCode}
                      onChange={setField('countryCode')}
                      className={`${fieldClass} sm:max-w-[11.5rem]`}
                      required
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder={t('owners.phonePh')}
                      value={form.phone}
                      onChange={setField('phone')}
                      className={fieldClass}
                      required
                    />
                  </div>
                </div>

                <label className="grid gap-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ch-clay">
                  {t('owners.destination')}
                  <select
                    value={form.destination}
                    onChange={setField('destination')}
                    className={fieldClass}
                    required
                  >
                    <option value="">{t('owners.selectDestination')}</option>
                    {destinationOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                    {!destinationOptions.includes('Other') && (
                      <option value="Other">{t('owners.other')}</option>
                    )}
                  </select>
                </label>

                <label className="grid gap-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ch-clay">
                  {t('owners.project')}
                  <select
                    value={form.project}
                    onChange={setField('project')}
                    className={fieldClass}
                    required
                    disabled={!form.destination}
                  >
                    <option value="">
                      {form.destination ? t('owners.selectProject') : t('owners.pickDestinationFirst')}
                    </option>
                    {projectOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                    <option value="Other">{t('owners.other')}</option>
                  </select>
                </label>

                <label className="grid gap-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ch-clay">
                  {t('owners.propertyType')}
                  <select
                    value={form.propertyType}
                    onChange={setField('propertyType')}
                    className={fieldClass}
                    required
                  >
                    <option value="">{t('owners.selectType')}</option>
                    {UNIT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ch-clay">
                  {t('owners.furnishing')}
                  <select
                    value={form.furnishingStatus}
                    onChange={setField('furnishingStatus')}
                    className={fieldClass}
                    required
                  >
                    <option value="">{t('owners.selectStatus')}</option>
                    {FURNISHING_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(`owners.${o.key}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ch-clay sm:col-span-2">
                  {t('owners.contactTime')}
                  <select
                    value={form.preferredContactTime}
                    onChange={setField('preferredContactTime')}
                    className={fieldClass}
                    required
                  >
                    <option value="">{t('owners.selectTime')}</option>
                    {CONTACT_TIMES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {t(`owners.${c.key}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {status && (
                <p
                  className={`mt-5 rounded-xl px-4 py-3 text-sm ${
                    status.type === 'success'
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border border-rose-200 bg-rose-50 text-rose-800'
                  }`}
                  role="status"
                >
                  {status.message}
                </p>
              )}

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="ch-btn mt-8 w-full"
              >
                {submitting ? t('owners.sending') : t('owners.submit')}
              </button>
            </form>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
