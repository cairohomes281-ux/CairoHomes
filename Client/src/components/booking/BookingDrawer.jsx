import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Minus, Plus, UserRound, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useCurrency } from '../../context/CurrencyContext';
import { useLocale } from '../../context/LocaleContext';
import api, { validatePromoCode } from '../../api/http';
import ListingDatePicker, { isoToLocalDate, localDateToIso } from '../listing/ListingDatePicker';
import { getMinimumStayNights } from '../../utils/bookingRules';
import IdentityPhotoUpload from './IdentityPhotoUpload';


function getGuestLoad(adults, children) {
  return Number(adults || 0) + Number(children || 0) * 0.5;
}

function rangeHitsBlocked(checkin, checkout, blockedDates = []) {
  if (!checkin || !checkout || !blockedDates.length) return false;
  const set = new Set(blockedDates);
  for (let t = new Date(`${checkin}T00:00:00`); localDateToIso(t) < checkout; t.setDate(t.getDate() + 1)) {
    if (set.has(localDateToIso(t))) return true;
  }
  return false;
}

function IncrementControl({ label, hint, value, onIncrement, onDecrement, min = 0, t }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-ch-line bg-white px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-ch-pine">{label}</p>
        {hint && <p className="text-xs text-ch-muted">{hint}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onDecrement}
          disabled={value <= min}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ch-line text-ch-muted hover:border-ch-pine hover:text-ch-pine disabled:opacity-40"
          aria-label={t('booking.decreaseAria', { label })}
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
        <span className="min-w-8 text-center text-sm font-semibold">{value}</span>
        <button
          type="button"
          onClick={onIncrement}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-ch-line text-ch-muted hover:border-ch-pine hover:text-ch-pine"
          aria-label={t('booking.increaseAria', { label })}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}


export default function BookingDrawer({
  open,
  onClose,
  unit,
  blockedDates = [],
  checkoutDates = [],
  dailyPrices = {},
  initialCheckin = '',
  initialCheckout = '',
  initialGuests = { adults: 1, children: 0, infants: 0 },
  initialQuote = null,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLocale();
  const { formatPrice } = useCurrency();
  const money = (n) => formatPrice(n, { perNight: false }) || '—';
  const [message, setMessage] = useState('');
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promo, setPromo] = useState({ code: '', percentage: 0, discountAmount: 0, isValid: false, loading: false });
  const [quote, setQuote] = useState(initialQuote);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [formState, setFormState] = useState({
    checkInDate: initialCheckin || '',
    checkOutDate: initialCheckout || '',
    adults: initialGuests.adults || 1,
    children: initialGuests.children || 0,
    infants: initialGuests.infants || 0,
    fullName: '',
    identityDocuments: [],
    phone: '',
    secondaryPhone: '',
    email: '',
    notes: '',
  });

  const minNights = getMinimumStayNights(unit);
  const capacity = Number(unit?.guests || unit?.capacity) || 8;
  const guestLoad = useMemo(
    () => getGuestLoad(formState.adults, formState.children),
    [formState.adults, formState.children]
  );
  const overCapacity = guestLoad > capacity;

  useEffect(() => {
    if (!open) return;
    setFormState((cur) => ({
      ...cur,
      checkInDate: initialCheckin || cur.checkInDate,
      checkOutDate: initialCheckout || cur.checkOutDate,
      adults: initialGuests.adults || cur.adults,
      children: initialGuests.children || cur.children,
      infants: initialGuests.infants || cur.infants,
    }));
    if (initialQuote) setQuote(initialQuote);
  }, [open, initialCheckin, initialCheckout, initialGuests, initialQuote]);

  useEffect(() => {
    if (!user) return;
    setFormState((cur) => ({
      ...cur,
      fullName: cur.fullName || user.full_name || user.user_metadata?.full_name || '',
      phone: cur.phone || user.phone || '',
      email: cur.email || user.email || '',
    }));
  }, [user]);

  useEffect(() => {
    if (!open) {
      setMessage('');
      setPromoCodeInput('');
      setPromo({ code: '', percentage: 0, discountAmount: 0, isValid: false, loading: false });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !unit?.slug || !formState.checkInDate || !formState.checkOutDate) {
      return undefined;
    }
    let cancelled = false;
    setQuoteLoading(true);
    const guests = Number(formState.adults || 0) + Number(formState.children || 0);
    api
      .get(`/units/${unit.slug}/quote`, {
        params: {
          checkin: formState.checkInDate,
          checkout: formState.checkOutDate,
          adults: formState.adults,
          teens: formState.children,
          guests,
        },
      })
      .then((r) => {
        if (!cancelled) setQuote(r.data);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, unit?.slug, formState.checkInDate, formState.checkOutDate, formState.adults, formState.children]);

  const nights = quote?.nights || 0;
  const belowMinimumStay = nights > 0 && nights < minNights;
  const isOverlapping = useMemo(
    () => rangeHitsBlocked(formState.checkInDate, formState.checkOutDate, blockedDates),
    [formState.checkInDate, formState.checkOutDate, blockedDates]
  );

  const subtotal = Number(quote?.subtotal || 0);
  const cleaning = Number(quote?.cleaning_fee_egp || 0);
  const access = Number(quote?.access_fee_egp || 0);
  const service = Number(quote?.service_fee_egp || 0);
  const gross = Number(quote?.total_egp || 0);
  const nightlyRate = nights > 0 && subtotal > 0 ? Math.round(subtotal / nights) : Number(unit?.price_fallback || 0);

  const promoDiscount = promo.isValid
    ? promo.percentage > 0
      ? Math.round(gross * (promo.percentage / 100))
      : Number(promo.discountAmount || 0)
    : 0;
  const finalTotal = Math.max(0, gross - promoDiscount);

  if (!open) return null;

  function handleChange(field, value) {
    setFormState((cur) => ({ ...cur, [field]: value }));
  }

  async function handlePromoValidation() {
    const code = String(promoCodeInput || '').trim();
    if (!code) {
      setPromo({ code: '', percentage: 0, discountAmount: 0, isValid: false, loading: false });
      return;
    }
    setPromo((p) => ({ ...p, loading: true }));
    setMessage('');
    try {
      const result = await validatePromoCode({
        code,
        amount: gross,
        email: formState.email,
        phone: formState.phone,
      });
      setPromo({
        code: result.code,
        percentage: result.percentage,
        discountAmount: result.discountAmount,
        isValid: true,
        loading: false,
      });
      setMessage(t('booking.promoAppliedMsg', { code: result.code }));
    } catch (err) {
      setPromo({ code: '', percentage: 0, discountAmount: 0, isValid: false, loading: false });
      setMessage(err.message || t('booking.invalidPromo'));
    }
  }

  function handleSubmit(event) {
    event?.preventDefault?.();
    setMessage('');

    if (!formState.checkInDate || !formState.checkOutDate) {
      setMessage(t('booking.needDates'));
      return;
    }
    if (!String(formState.fullName || '').trim()) {
      setMessage(t('booking.needName'));
      return;
    }
    if (!String(formState.phone || '').trim()) {
      setMessage(t('booking.needPhone'));
      return;
    }
    if (!String(formState.email || '').trim()) {
      setMessage(t('booking.needEmail'));
      return;
    }
    if (!quote?.available) {
      setMessage(quote?.reason || t('booking.notAvailable'));
      return;
    }
    if (belowMinimumStay) {
      setMessage(t('booking.minStay', { count: minNights }));
      return;
    }
    if (!formState.identityDocuments?.length) {
      setMessage(t('booking.needId'));
      return;
    }
    if (isOverlapping) {
      setMessage(t('booking.overlap'));
      return;
    }

    const checkoutState = {
      unit,
      formState,
      quote,
      nights,
      nightlyRate,
      subtotalAmount: subtotal,
      cleaningFee: cleaning,
      accessFee: access,
      serviceFee: service,
      feeLines: quote?.lines || [],
      grossAmount: gross,
      discountPercentage: promo.percentage,
      discountAmount: promoDiscount,
      finalTotalAmount: finalTotal,
      promoCode: promo.isValid ? promo.code : '',
      totalAmount: finalTotal,
    };

    onClose?.();
    navigate('/checkout/payment', { state: checkoutState });
  }

  return (
    <div className="fixed inset-0 z-[240] flex justify-end bg-slate-950/55 backdrop-blur-[2px]">
      <button type="button" className="absolute inset-0 cursor-default" aria-label={t('common.close')} onClick={onClose} />

      <aside className="relative flex h-full w-full max-w-none flex-col bg-white shadow-2xl lg:ml-auto lg:max-w-[50.4rem] lg:border-l lg:border-ch-line">
        <div className="flex items-center justify-between border-b border-ch-line px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-ch-muted">{t('booking.drawerEyebrow')}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold text-ch-pine">
              {t('booking.bookTitle', { title: unit?.title || t('booking.thisResidence') })}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-ch-line text-ch-muted hover:border-ch-pine hover:text-ch-pine"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
            <form id="booking-drawer-form" onSubmit={handleSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ch-muted">
                    {t('booking.checkInOut')}
                  </p>
                  <ListingDatePicker
                    inline
                    value={{
                      start: isoToLocalDate(formState.checkInDate),
                      end: isoToLocalDate(formState.checkOutDate),
                    }}
                    onChange={({ start, end }) => {
                      setFormState((cur) => ({
                        ...cur,
                        checkInDate: start ? localDateToIso(start) : '',
                        checkOutDate: end ? localDateToIso(end) : '',
                      }));
                      setMessage('');
                    }}
                    blockedDates={blockedDates}
                    checkoutDates={checkoutDates}
                    dailyPrices={dailyPrices}
                    minNights={minNights}
                  />
                  {isOverlapping && (
                    <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                      {t('booking.overlapWarning')}
                    </p>
                  )}
                  {belowMinimumStay && (
                    <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                      {t('booking.minStay', { count: minNights })}
                    </p>
                  )}
                </div>

                <IncrementControl
                  t={t}
                  label={t('booking.adults')}
                  hint={t('booking.adultsHint')}
                  value={formState.adults}
                  min={1}
                  onDecrement={() => handleChange('adults', Math.max(1, Number(formState.adults || 1) - 1))}
                  onIncrement={() => handleChange('adults', Number(formState.adults || 1) + 1)}
                />
                <IncrementControl
                  t={t}
                  label={t('booking.children')}
                  hint={t('booking.childrenHint')}
                  value={formState.children}
                  min={0}
                  onDecrement={() => handleChange('children', Math.max(0, Number(formState.children || 0) - 1))}
                  onIncrement={() => handleChange('children', Number(formState.children || 0) + 1)}
                />

                <div
                  className={`md:col-span-2 rounded-2xl border px-4 py-3 text-sm ${
                    overCapacity
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : 'border-ch-line bg-[#faf9f7] text-ch-muted'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-ch-pine">{t('booking.guestLoad')}</span>
                    <span className="font-semibold text-ch-pine">
                      {guestLoad} / {capacity}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5">
                    {t('booking.guestLoadHint')}
                  </p>
                  {overCapacity && (
                    <p className="mt-2 text-xs font-semibold">
                      {t('booking.overCapacity')}
                    </p>
                  )}
                </div>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ch-muted md:col-span-2">
                  {t('booking.fullLegalName')}
                  <div className="flex items-center gap-3 rounded-2xl border border-ch-line bg-white px-4 py-3 focus-within:border-ch-pine">
                    <UserRound className="h-4 w-4 text-ch-muted" />
                    <input
                      value={formState.fullName}
                      onChange={(e) => handleChange('fullName', e.target.value)}
                      className="w-full bg-transparent text-sm outline-none"
                      placeholder={t('booking.fullLegalNamePh')}
                      required
                    />
                  </div>
                </label>

                <div className="md:col-span-2">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-ch-muted">
                    {t('booking.idPhotos')}
                  </p>
                  <IdentityPhotoUpload
                    files={formState.identityDocuments}
                    onChange={(next) => handleChange('identityDocuments', next)}
                  />
                </div>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ch-muted">
                  {t('booking.phone')}
                  <input
                    value={formState.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    className="rounded-2xl border border-ch-line bg-white px-4 py-3 text-sm outline-none focus:border-ch-pine"
                    placeholder={t('booking.phonePh')}
                    required
                  />
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ch-muted">
                  {t('booking.secondaryPhone')}
                  <input
                    value={formState.secondaryPhone}
                    onChange={(e) => handleChange('secondaryPhone', e.target.value)}
                    className="rounded-2xl border border-ch-line bg-white px-4 py-3 text-sm outline-none focus:border-ch-pine"
                    placeholder={t('common.optional')}
                  />
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ch-muted md:col-span-2">
                  {t('booking.email')}
                  <div className="flex items-center gap-3 rounded-2xl border border-ch-line bg-white px-4 py-3 focus-within:border-ch-pine">
                    <Mail className="h-4 w-4 text-ch-muted" />
                    <input
                      type="email"
                      value={formState.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      className="w-full bg-transparent text-sm outline-none"
                      placeholder={t('booking.emailPh')}
                      required
                    />
                  </div>
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ch-muted md:col-span-2">
                  {t('booking.notes')}
                  <textarea
                    value={formState.notes}
                    onChange={(e) => handleChange('notes', e.target.value)}
                    rows={4}
                    className="rounded-2xl border border-ch-line bg-white px-4 py-3 text-sm outline-none focus:border-ch-pine"
                    placeholder={t('booking.notesPh')}
                  />
                </label>

                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-ch-muted md:col-span-2">
                  {t('booking.promo')}
                  <div className="flex gap-3">
                    <input
                      value={promoCodeInput}
                      onChange={(e) => setPromoCodeInput(e.target.value)}
                      className="w-full rounded-2xl border border-ch-line bg-white px-4 py-3 text-sm outline-none focus:border-ch-pine"
                      placeholder={t('booking.promoPh')}
                    />
                    <button
                      type="button"
                      onClick={handlePromoValidation}
                      disabled={promo.loading || !gross}
                      className="inline-flex items-center justify-center rounded-2xl bg-ch-pine px-4 py-3 text-xs font-semibold uppercase tracking-widest text-white hover:bg-ch-pine-dark disabled:opacity-70"
                    >
                      {promo.loading ? t('booking.checking') : t('booking.verify')}
                    </button>
                  </div>
                  {promo.isValid && (
                    <p className="text-xs font-semibold text-emerald-600">{t('booking.promoApplied', { code: promo.code })}</p>
                  )}
                </label>
              </div>
            </form>
        </div>

        <div className="border-t border-ch-line bg-white px-6 py-5">
            <div className="grid gap-3 rounded-3xl border border-ch-line bg-ch-pine-50/40 p-4">
              <div className="flex items-center justify-between text-sm text-ch-muted">
                <span>{t('booking.nightlyRate')}</span>
                <span className="font-semibold text-ch-pine">{money(nightlyRate)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-ch-muted">
                <span>{t('booking.subtotalNights', { count: nights || '—' })}</span>
                <span className="font-semibold text-ch-pine">{money(subtotal)}</span>
              </div>
              {cleaning > 0 && (
                <div className="flex items-center justify-between text-sm text-ch-muted">
                  <span>{t('booking.cleaning')}</span>
                  <span className="font-semibold text-ch-pine">{money(cleaning)}</span>
                </div>
              )}
              {access > 0 && (
                <div className="flex items-center justify-between text-sm text-ch-muted">
                  <span>{t('booking.accessBeach')}</span>
                  <span className="font-semibold text-ch-pine">{money(access)}</span>
                </div>
              )}
              {service > 0 && (
                <div className="flex items-center justify-between text-sm text-ch-muted">
                  <span>{t('booking.serviceTax')}</span>
                  <span className="font-semibold text-ch-pine">{money(service)}</span>
                </div>
              )}
              {promo.isValid && (
                <div className="flex items-center justify-between text-sm text-emerald-700">
                  <span>{t('booking.promoDiscount')}</span>
                  <span className="font-semibold">− {money(promoDiscount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm text-ch-muted border-t border-ch-line pt-3">
                <span>{t('booking.estimatedTotal')}</span>
                <span className="font-num text-lg font-bold text-ch-pine">
                  {quoteLoading ? '…' : money(finalTotal)}
                </span>
              </div>
              {!quote?.available && quote && (
                <p className="text-xs text-rose-600">{quote.reason || t('booking.unavailable')}</p>
              )}
            </div>

            {message && (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{message}</div>
            )}

            <button
              type="submit"
              form="booking-drawer-form"
              disabled={isOverlapping || belowMinimumStay || !quote?.available || quoteLoading}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ch-pine px-5 py-4 text-xs font-semibold uppercase tracking-widest text-white hover:bg-ch-pine-dark disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {t('booking.proceedPayment')}
            </button>
          </div>
      </aside>
    </div>
  );
}
