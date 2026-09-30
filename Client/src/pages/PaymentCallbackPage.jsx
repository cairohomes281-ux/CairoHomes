import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import BookingRequestSuccess from '../components/booking/BookingRequestSuccess';
import { useLocale } from '../context/LocaleContext';
import { reportEvent } from '../utils/siteTelemetry';

export default function PaymentCallbackPage() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  const status = params.get('status') || 'success';
  const bookingId = params.get('booking_id');
  const ok = status === 'success';

  useEffect(() => {
    reportEvent({ event: ok ? 'payment_success' : 'payment_fail' });
  }, [ok]);

  if (ok) {
    return (
      <div>
        <Header />
        <BookingRequestSuccess
          title={t('payment.callbackOkTitle')}
          description={t('payment.callbackOkBody', {
            booking: bookingId ? t('payment.callbackOkBooking', { id: bookingId }) : '',
          })}
          note={t('payment.pendingNote')}
          primaryLabel={t('payment.browseStays')}
          primaryTo="/search"
          secondaryLabel={t('payment.myAccount')}
          secondaryTo="/account"
          LinkComponent={Link}
        />
        <Footer />
      </div>
    );
  }

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-lg px-5 py-20 text-center">
        <h1 className="font-display text-4xl text-ch-pine">{t('payment.callbackFailTitle')}</h1>
        <p className="mt-4 text-ch-muted">{t('payment.callbackFailBody')}</p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/search" className="btn-pill bg-ch-pine text-white px-6 py-3 font-semibold">
            {t('payment.browseStays')}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
