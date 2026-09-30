import { Link, useSearchParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import BookingRequestSuccess from '../components/booking/BookingRequestSuccess';
import { useLocale } from '../context/LocaleContext';

export default function BookingSuccessPage() {
  const { t } = useLocale();
  const [params] = useSearchParams();
  const id = params.get('id') || t('bookingSuccess.pending');

  return (
    <div>
      <Header />
      <BookingRequestSuccess
        title={t('bookingSuccess.title')}
        description={t('bookingSuccess.body', { id })}
        note={t('bookingSuccess.note')}
        primaryLabel={t('bookingSuccess.backHome')}
        primaryTo="/"
        LinkComponent={Link}
      />
      <Footer />
    </div>
  );
}
