import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, Building2, Calendar, CreditCard, ShieldCheck, Wallet } from 'lucide-react';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import CheckoutAuthGate from '../components/booking/CheckoutAuthGate';
import BookingRequestSuccess from '../components/booking/BookingRequestSuccess';
import { createBookingCheckout } from '../api/http';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { reportError, reportEvent } from '../utils/siteTelemetry';

const money = (n) => `EGP ${Number(n || 0).toLocaleString('en-US')}`;


export default function PaymentPage() {
  const { t } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const checkoutState = location.state;
  const [selectedMethod, setSelectedMethod] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [successCard, setSuccessCard] = useState(null);

  const policies = Array.from({ length: 10 }, (_, i) => t(`payment.policy${i}`));

  if (!checkoutState) {
    return (
      <div>
        <Header />
        <main className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
          <div className="max-w-md rounded-3xl border border-ch-line bg-white p-8 shadow-xl">
            <h2 className="font-display text-2xl font-semibold text-ch-pine">{t('payment.noData')}</h2>
            <p className="mt-3 text-sm text-ch-muted">
              {t('payment.noDataHint')}
            </p>
            <Link
              to="/search"
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-ch-pine px-6 py-3 text-sm font-semibold text-white hover:bg-ch-pine-dark"
            >
              <ArrowLeft className="h-4 w-4" /> {t('payment.browseStays')}
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (successCard) {
    return (
      <div>
        <Header />
        <BookingRequestSuccess
          title={t('payment.submitted')}
          description={successCard.description}
          note={t('payment.pendingNote')}
          primaryLabel={t('payment.backToStays')}
          onPrimary={() => navigate('/search')}
        />
        <Footer />
      </div>
    );
  }

  const {
    unit,
    formState,
    quote,
    nights,
    nightlyRate,
    subtotalAmount,
    cleaningFee,
    accessFee,
    serviceFee,
    feeLines = [],
    grossAmount,
    discountPercentage,
    discountAmount,
    finalTotalAmount,
    promoCode,
  } = checkoutState;

  async function handleConfirmReservation() {
    if (!user) {
      setMessage(t('payment.needAuth'));
      reportError({ type: 'checkout', message: 'Payment blocked: guest not signed in' });
      return;
    }
    if (!selectedMethod) {
      setMessage(t('payment.needMethod'));
      reportError({ type: 'checkout', message: 'Payment blocked: no payment method' });
      return;
    }
    const identityDocuments = Array.isArray(formState?.identityDocuments) ? formState.identityDocuments : [];
    if (!identityDocuments.length) {
      setMessage(t('payment.needId'));
      reportError({ type: 'checkout', message: 'Payment blocked: missing ID documents' });
      return;
    }

    setSubmitting(true);
    setMessage('');

    try {
      const payload = new FormData();
      payload.append('slug', unit?.slug || '');
      payload.append('checkin', formState.checkInDate || '');
      payload.append('checkout', formState.checkOutDate || '');
      const adults = Math.max(1, Number(formState.adults || 1));
      const children = Math.max(0, Number(formState.children || 0));
      const nannyCount = Math.max(0, Number(formState.nanny_count || formState.nanny || 0));
      payload.append('adults', String(adults));
      payload.append('children', String(children));
      payload.append('teens', String(children));
      payload.append('nanny_count', String(nannyCount));
      payload.append('guests', String(adults + children + nannyCount));
      payload.append('guest_name', formState.fullName || '');
      payload.append('guest_phone', formState.phone || '');
      payload.append('guest_email', formState.email || '');
      payload.append(
        'notes',
        [formState.notes, formState.secondaryPhone ? `Secondary phone: ${formState.secondaryPhone}` : '']
          .filter(Boolean)
          .join('\n')
      );
      payload.append('payment_method', selectedMethod);
      if (promoCode) payload.append('promo_code', promoCode);
      payload.append('callback_url', `${window.location.origin}/checkout/payment/callback`);
      identityDocuments.forEach((file) => payload.append('id_photos', file));

      reportEvent({
        event: 'checkout_submit',
        unit_slug: unit?.slug || '',
      });
      const data = await createBookingCheckout(payload);

      if (selectedMethod === 'paymob_card') {
        if (data.redirectToPaymob && data.checkoutUrl) {
          reportEvent({ event: 'payment_redirect', unit_slug: unit?.slug || '' });
          window.location.assign(data.checkoutUrl);
          return;
        }
        setMessage(t('payment.cardNotConfigured'));
        reportError({ type: 'payment', message: 'Card checkout is not configured' });
        reportEvent({ event: 'payment_fail', unit_slug: unit?.slug || '' });
        return;
      }

      if (selectedMethod === 'instapay') {
        reportEvent({ event: 'booking_submitted', unit_slug: unit?.slug || '' });
        setSuccessCard({
          description: t('payment.instapaySuccess'),
        });
        return;
      }

      reportEvent({ event: 'booking_submitted', unit_slug: unit?.slug || '' });
      setSuccessCard({
        description: t('payment.cashSuccess'),
      });
    } catch (err) {
      setMessage(err.response?.data?.error || err.message || t('payment.unable'));
      reportEvent({ event: 'payment_fail', unit_slug: unit?.slug || '' });
    } finally {
      setSubmitting(false);
    }
  }

  const methodLabel =
    selectedMethod === 'paymob_card' ? t('payment.card') : selectedMethod === 'instapay' ? t('payment.instapay') : t('payment.cash');

  return (
    <div>
      <Header />
      <main className="min-h-screen bg-[#f7f8fb] px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-8">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-2 text-sm font-medium text-ch-muted hover:text-ch-pine"
            >
              <ArrowLeft className="h-4 w-4" /> {t('payment.backDetails')}
            </button>
            <h1 className="mt-3 font-display text-3xl font-semibold text-ch-pine md:text-4xl">{t('payment.title')}</h1>
            <p className="mt-1.5 text-sm text-ch-muted">{t('payment.subtitle')}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
            <div className="order-1 lg:order-2 lg:col-span-4">
              <div className="rounded-3xl border border-ch-line bg-white p-6 shadow-sm lg:sticky lg:top-24">
                <h2 className="text-lg font-bold text-ch-pine">{t('payment.summary')}</h2>

                <div className="mt-4 border-b border-ch-line pb-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ch-muted">
                    {unit?.compound || unit?.area || unit?.project}
                  </p>
                  <h3 className="mt-1 text-sm font-bold text-ch-pine">{unit?.title}</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ch-muted">
                      <Building2 className="h-3 w-3" /> {unit?.property_type || t('payment.residenceFallback')}
                    </span>
                  </div>
                </div>

                <div className="mt-4 space-y-3 border-b border-ch-line pb-4">
                  <div className="flex items-center gap-3 text-xs text-ch-muted">
                    <Calendar className="h-4 w-4 text-ch-pine" />
                    <div>
                      <p className="font-semibold text-ch-pine">{t('payment.checkIn')}</p>
                      <p>{formState.checkInDate}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-ch-muted">
                    <Calendar className="h-4 w-4 text-ch-pine" />
                    <div>
                      <p className="font-semibold text-ch-pine">{t('payment.checkOut')}</p>
                      <p>{formState.checkOutDate}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-ch-muted">
                  <div className="flex justify-between">
                    <span>{t('payment.nightlyRate')}</span>
                    <span className="font-semibold text-ch-pine">{money(nightlyRate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('payment.duration')}</span>
                    <span className="font-semibold text-ch-pine">
                      {nights} {nights === 1 ? t('common.night') : t('common.nights')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('payment.subtotal')}</span>
                    <span className="font-semibold text-ch-pine">{money(subtotalAmount)}</span>
                  </div>
                  {(feeLines.length ? feeLines : [
                    cleaningFee > 0 && { key: 'cleaning', label: t('payment.cleaning'), amount: cleaningFee },
                    accessFee > 0 && { key: 'access', label: t('payment.accessBeach'), amount: accessFee },
                    serviceFee > 0 && {
                      key: 'service',
                      label: t('payment.serviceTax'),
                      amount: serviceFee,
                    },
                  ].filter(Boolean)
                  ).map((line) => (
                    <div key={line.key || line.label} className="flex justify-between">
                      <span>{line.label}</span>
                      <span className="font-semibold text-ch-pine">{money(line.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between">
                    <span>{t('payment.invoiceBefore')}</span>
                    <span className="font-semibold text-ch-pine">{money(grossAmount ?? quote?.total_egp)}</span>
                  </div>
                  {promoCode ? (
                    <div className="flex justify-between text-emerald-700">
                      <span>
                        {t('payment.promoLabel', { code: promoCode })}
                        {discountPercentage ? ` (${discountPercentage}%)` : ''}
                      </span>
                      <span className="font-semibold">− {money(discountAmount)}</span>
                    </div>
                  ) : null}
                  <div className="mt-2 flex items-baseline justify-between border-t border-ch-line pt-3">
                    <span className="text-sm font-bold text-ch-pine">{t('payment.finalTotal')}</span>
                    <span className="font-num text-xl font-semibold text-ch-pine">
                      {money(finalTotalAmount)}
                    </span>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-ch-line bg-ch-pine-50/40 p-4">
                  <h3 className="text-sm font-bold text-ch-pine">{t('payment.policiesTitle')}</h3>
                  <ul className="mt-3 space-y-2 text-xs text-ch-muted">
                    {policies.map((policy) => (
                      <li key={policy} className="flex items-start gap-2">
                        <span className="mt-1 h-1.5 w-1.5 rounded-full bg-ch-pine/40 flex-none" />
                        <span>{policy}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="order-2 space-y-6 lg:order-1 lg:col-span-8">
              {!user ? (
                <CheckoutAuthGate
                  prefill={{
                    fullName: formState?.fullName || '',
                    email: formState?.email || '',
                    phone: formState?.phone || '',
                  }}
                />
              ) : (
              <div className="rounded-3xl border border-ch-line bg-white p-6 shadow-sm sm:p-8">
                <h2 className="text-xl font-bold text-ch-pine">{t('payment.selectMethod')}</h2>
                <p className="mt-1 text-sm text-ch-muted">
                  {t('payment.signedInAs', { who: user.email || user.full_name })}
                </p>

                <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <MethodCard
                    active={selectedMethod === 'instapay'}
                    onClick={() => { setSelectedMethod('instapay'); setMessage(''); }}
                    icon={<Wallet className="h-6 w-6" strokeWidth={1.8} />}
                    iconClass="bg-indigo-50 text-indigo-600"
                    activeClass="border-indigo-600 bg-indigo-50/20 ring-indigo-600/10"
                    title={t('payment.instapay')}
                    subtitle={t('payment.instapaySub')}
                    badgeActive="bg-indigo-100 text-indigo-700"
                    t={t}
                  />
                  <MethodCard
                    disabled
                    comingSoon
                    active={false}
                    onClick={() => {}}
                    icon={<CreditCard className="h-6 w-6" strokeWidth={1.8} />}
                    iconClass="bg-slate-100 text-slate-400"
                    activeClass=""
                    title={t('payment.card')}
                    subtitle={t('payment.cardSub')}
                    badgeActive=""
                    t={t}
                  />
                  <MethodCard
                    active={selectedMethod === 'cash'}
                    onClick={() => { setSelectedMethod('cash'); setMessage(''); }}
                    icon={<Banknote className="h-6 w-6" strokeWidth={1.8} />}
                    iconClass="bg-emerald-50 text-emerald-600"
                    activeClass="border-emerald-600 bg-emerald-50/20 ring-emerald-600/10"
                    title={t('payment.cash')}
                    subtitle={t('payment.cashSub')}
                    badgeActive="bg-emerald-100 text-emerald-700"
                    t={t}
                  />
                </div>

                {selectedMethod === 'instapay' || selectedMethod === 'cash' ? (
                  <div className="mt-6 rounded-2xl border-2 border-red-500 bg-red-50 p-4 sm:p-5">
                    <div className="flex gap-3">
                      <ShieldCheck className="h-6 w-6 flex-shrink-0 text-red-600" />
                      <div>
                        <h4 className="text-base font-extrabold text-red-700 sm:text-lg">
                          {t('payment.depositWarningTitle')}
                        </h4>
                        <p className="mt-2 text-sm font-semibold leading-6 text-red-700 sm:text-[15px]">
                          {t('payment.depositWarningBody', {
                            method: methodLabel,
                            amount: money(Math.round((Number(finalTotalAmount) || 0) * 0.5)),
                          })}
                        </p>
                        <p className="mt-2 text-sm font-medium leading-6 text-red-700">
                          {t('payment.depositContinueNote')}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-red-600/90">
                          {selectedMethod === 'cash'
                            ? t('payment.cashHint')
                            : t('payment.instapayHint')}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : selectedMethod ? (
                  <div className="mt-6 rounded-2xl border border-ch-line bg-ch-pine-50/50 p-4">
                    <div className="flex gap-3">
                      <ShieldCheck className="h-5 w-5 flex-shrink-0 text-ch-pine" />
                      <div>
                        <h4 className="text-sm font-bold text-ch-pine">
                          {t('payment.readyVia', { method: methodLabel })}
                        </h4>
                        <p className="mt-1 text-xs leading-5 text-ch-muted">{t('payment.paymobHint')}</p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {message && <p className="mt-4 text-sm text-rose-600">{message}</p>}

                <button
                  type="button"
                  onClick={handleConfirmReservation}
                  disabled={!selectedMethod || submitting}
                  className="mt-6 inline-flex items-center justify-center rounded-full bg-ch-pine px-6 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white hover:bg-ch-pine-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? t('payment.processing') : t('payment.confirm')}
                </button>
              </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function MethodCard({
  active,
  onClick,
  icon,
  iconClass,
  activeClass,
  title,
  subtitle,
  badgeActive,
  disabled = false,
  comingSoon = false,
  t,
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={`relative flex flex-col items-center justify-between rounded-3xl border-2 p-5 text-center transition-all ${
        disabled
          ? 'cursor-not-allowed border-ch-line/70 bg-slate-50 opacity-55'
          : active
            ? `${activeClass} shadow-md ring-2`
            : 'border-ch-line bg-white hover:border-ch-pine/40 hover:shadow-sm'
      }`}
    >
      {comingSoon ? (
        <span className="absolute right-3 top-3 rounded-full bg-slate-200/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          {t('payment.comingSoon')}
        </span>
      ) : null}
      <div className={`flex h-12 w-12 items-center justify-center rounded-full ${iconClass}`}>{icon}</div>
      <div className="mt-4">
        <h3 className={`text-sm font-bold ${disabled ? 'text-slate-500' : 'text-ch-pine'}`}>{title}</h3>
        <p className="mt-1 text-xs text-ch-muted">{subtitle}</p>
      </div>
      <span
        className={`mt-4 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
          comingSoon
            ? 'bg-slate-200 text-slate-600'
            : active
              ? badgeActive
              : 'bg-ch-pine-50 text-ch-muted'
        }`}
      >
        {comingSoon ? t('payment.comingSoon') : active ? t('payment.selected') : t('payment.select')}
      </span>
    </button>
  );
}
