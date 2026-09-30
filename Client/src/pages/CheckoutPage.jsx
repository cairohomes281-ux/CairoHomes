import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import api from '../api/http';
import { useLocale } from '../context/LocaleContext';
import { reportEvent } from '../utils/siteTelemetry';

export default function CheckoutPage() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const slug = params.get('slug');
  const checkin = params.get('checkin');
  const checkout = params.get('checkout');
  const guests = params.get('guests') || '2';

  const [form, setForm] = useState({
    guest_name: '',
    guest_email: '',
    guest_phone: '',
    payment_method: 'instapay',
    promo_code: '',
    notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const summary = useMemo(
    () => ({ slug, checkin, checkout, guests }),
    [slug, checkin, checkout, guests]
  );

  const fieldLabels = {
    guest_name: t('checkout.name'),
    guest_email: t('checkout.email'),
    guest_phone: t('checkout.phone'),
  };

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/bookings/checkout', {
        ...summary,
        ...form,
        guests: Number(guests),
        callback_url: `${window.location.origin}/checkout/payment/callback`,
      });
      if (data.redirectToPaymob && data.checkoutUrl) {
        reportEvent({ event: 'payment_redirect', unit_slug: slug || '' });
        window.location.href = data.checkoutUrl;
        return;
      }
      reportEvent({ event: 'booking_submitted', unit_slug: slug || '' });
      navigate(`/booking-success?id=${data.booking?.id || ''}`);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      reportEvent({ event: 'payment_fail', unit_slug: slug || '' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-xl px-5 py-12">
        <h1 className="font-display text-4xl text-ch-pine">{t('checkout.title')}</h1>
        <p className="mt-2 text-ch-muted text-sm">
          {t('checkout.summary', { slug, checkin, checkout, guests })}
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          {['guest_name', 'guest_email', 'guest_phone'].map((k) => (
            <label key={k} className="block text-sm">
              {fieldLabels[k]}
              <input
                required={k !== 'guest_email'}
                type={k.includes('email') ? 'email' : 'text'}
                className="mt-1 w-full border border-ch-line rounded-xl px-3 py-2"
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </label>
          ))}
          <label className="block text-sm">
            {t('checkout.paymentMethod')}
            <select
              className="mt-1 w-full border border-ch-line rounded-xl px-3 py-2"
              value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
            >
              <option value="instapay">{t('checkout.instapay')}</option>
              <option value="cash">{t('checkout.cashHold')}</option>
              <option value="paymob_card" disabled>
                {t('checkout.cardSoon')}
              </option>
            </select>
          </label>
          <label className="block text-sm">
            {t('checkout.promo')}
            <input
              className="mt-1 w-full border border-ch-line rounded-xl px-3 py-2"
              value={form.promo_code}
              onChange={(e) => setForm({ ...form, promo_code: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            {t('checkout.notes')}
            <textarea
              className="mt-1 w-full border border-ch-line rounded-xl px-3 py-2"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={busy || !slug} className="w-full btn-pill bg-ch-pine text-white py-3 font-semibold disabled:opacity-40">
            {busy ? t('checkout.processing') : t('checkout.submit')}
          </button>
          <p className="text-xs text-ch-muted text-center">
            {t('checkout.pendingNote')}
          </p>
        </form>
        <Link to={`/listings/${slug}`} className="block text-center text-sm mt-4 text-ch-muted">
          {t('checkout.backListing')}
        </Link>
      </main>
      <Footer />
    </div>
  );
}
