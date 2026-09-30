import { useEffect, useState } from 'react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import PageHero from '../components/layout/PageHero';
import api from '../api/http';
import { useLocale } from '../context/LocaleContext';
import BrandLoader from '../components/ui/BrandLoader';

const emptyForm = { fullName: '', email: '', phone: '' };

function ApplicationModal({ job, onClose }) {
  const { t } = useLocale();
  const [form, setForm] = useState(emptyForm);
  const [cvFile, setCvFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);

  if (!job) return null;

  const updateField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!cvFile) {
      setStatus({ type: 'error', message: t('careers.needCv') });
      return;
    }
    setSubmitting(true);
    setStatus(null);
    try {
      const fd = new FormData();
      fd.append('job_id', job.id);
      fd.append('full_name', form.fullName.trim());
      fd.append('email', form.email.trim());
      fd.append('phone', form.phone.trim());
      fd.append('cv', cvFile);
      await api.post('/recruitment/apply', fd);
      setStatus({ type: 'success', message: t('careers.success') });
      setForm(emptyForm);
      setCvFile(null);
      setTimeout(onClose, 1600);
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.response?.data?.error || err.message || t('careers.submitFail'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-ch-muted">{t('careers.applyFor')}</p>
            <h2 className="mt-1 font-display text-xl text-ch-pine">{job.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-ch-line px-3 py-1 text-sm text-ch-muted hover:bg-ch-pine-50"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="grid gap-2 text-xs uppercase tracking-[0.18em] text-ch-muted">
            {t('careers.fullName')}
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => updateField('fullName', e.target.value)}
              className="rounded-xl border border-ch-line px-4 py-3 text-sm text-ch-pine outline-none focus:border-ch-pine"
              required
            />
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-[0.18em] text-ch-muted">
            {t('careers.email')}
            <input
              type="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              className="rounded-xl border border-ch-line px-4 py-3 text-sm text-ch-pine outline-none focus:border-ch-pine"
              required
            />
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-[0.18em] text-ch-muted">
            {t('careers.phone')}
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              className="rounded-xl border border-ch-line px-4 py-3 text-sm text-ch-pine outline-none focus:border-ch-pine"
              required
            />
          </label>
          <label className="grid gap-2 text-xs uppercase tracking-[0.18em] text-ch-muted">
            {t('careers.cv')}
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setCvFile(e.target.files?.[0] || null)}
              className="rounded-xl border border-ch-line px-4 py-3 text-sm text-ch-pine outline-none"
              required
            />
          </label>

          {status ? (
            <div
              className={`rounded-xl border p-3 text-sm ${
                status.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {status.message}
            </div>
          ) : null}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-ch-line px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-ch-pine"
            >
              {t('careers.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-pill bg-ch-pine px-6 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white disabled:opacity-70"
            >
              {submitting ? t('careers.submitting') : t('careers.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CareersPage() {
  const { t } = useLocale();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedJob, setSelectedJob] = useState(null);

  useEffect(() => {
    let mounted = true;
    api
      .get('/recruitment/jobs')
      .then((r) => {
        if (mounted) setJobs(r.data.items || []);
      })
      .catch((err) => {
        if (mounted) setError(err.response?.data?.error || err.message || t('careers.failed'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="bg-ch-ivory">
      <Header />
      <PageHero compact eyebrow={t('careers.eyebrow')} title={t('careers.title')} titleEm={t('careers.titleEm')} body={t('careers.subtitle')} />
      <main className="ch-container ch-section">

        {loading ? (
          <div className="mt-10 flex justify-center py-8">
            <BrandLoader size="md" label={t('careers.loading')} />
          </div>
        ) : null}

        {error ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-[1.5rem] border border-dashed border-ch-pine/25 bg-ch-rose/40 px-6 py-10 text-center text-[15px] text-ch-muted">
            {error}
          </div>
        ) : null}

        {!loading && !error && !jobs.length ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-[1.5rem] border border-dashed border-ch-pine/25 bg-ch-rose/40 px-6 py-10 text-center text-[15px] text-ch-muted">
            {t('careers.empty')}
          </div>
        ) : null}

        <div className="mx-auto grid max-w-4xl border-t border-ch-line">
          {jobs.map((job) => (
            <article key={job.id} className="border-b border-ch-line py-10">
              {(job.department || job.location) && (
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-ch-clay">
                  {[job.department, job.location].filter(Boolean).join(' · ')}
                </p>
              )}
              <h2 className="mt-2 font-display text-[1.9rem] text-ch-pine-dark">{job.title}</h2>
              <p className="mt-3 text-sm leading-7 text-ch-muted whitespace-pre-line">{job.description}</p>
              {job.requirements ? (
                <p className="mt-3 text-sm leading-7 text-ch-muted/90 whitespace-pre-line">
                  <span className="font-medium text-ch-pine">{t('careers.requirements')} </span>
                  {job.requirements}
                </p>
              ) : null}
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => setSelectedJob(job)}
                  className="ch-btn"
                >
                  {t('careers.applyNow')}
                </button>
              </div>
            </article>
          ))}
        </div>

        <ApplicationModal job={selectedJob} onClose={() => setSelectedJob(null)} />
      </main>
      <Footer />
    </div>
  );
}
