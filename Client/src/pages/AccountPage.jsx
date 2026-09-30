import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import api from '../api/http';
import ListingCard from '../components/ListingCard';
import { getListingWpId, useWishlist } from '../hooks/useWishlist';
import BrandLoader from '../components/ui/BrandLoader';

const HOUSEKEEPING_TIMES = (() => {
  const out = [];
  for (let h = 3; h <= 23; h++) {
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    const suffix = h < 12 ? 'AM' : 'PM';
    out.push(`${hour12}:00 ${suffix}`);
  }
  return out;
})();

function datesInStay(checkin, checkout) {
  const out = [];
  if (!checkin || !checkout) return out;
  const start = new Date(`${String(checkin).slice(0, 10)}T00:00:00`);
  const end = new Date(`${String(checkout).slice(0, 10)}T00:00:00`);
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function money(n) {
  return Number(n || 0).toLocaleString('en-EG');
}

export default function AccountPage() {
  const { t } = useLocale();
  const { user, signOut } = useAuth();
  const [trips, setTrips] = useState([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hkBookingId, setHkBookingId] = useState(null);
  const [hkDate, setHkDate] = useState('');
  const [hkTime, setHkTime] = useState('10:00 AM');
  const [hkBusy, setHkBusy] = useState(false);
  const [hkMsg, setHkMsg] = useState(null);

  async function refresh() {
    if (!user) return;
    setLoading(true);
    try {
      const [tripsRes, meRes] = await Promise.all([
        api.get('/bookings/mine'),
        api.get('/auth/me'),
      ]);
      setTrips(tripsRes.data.items || []);
      setPoints(Number(meRes.data?.profile?.home_points) || 0);
    } catch {
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [user]);

  const activeStay = useMemo(
    () => trips.find((t2) => t2.is_current_stay && t2.status === 'confirmed'),
    [trips]
  );

  const stayDates = useMemo(
    () => datesInStay(activeStay?.checkin, activeStay?.checkout),
    [activeStay]
  );

  useEffect(() => {
    if (activeStay) {
      setHkBookingId(activeStay.id);
      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      setHkDate(stayDates.includes(todayIso) ? todayIso : stayDates[0] || '');
    } else {
      setHkBookingId(null);
    }
  }, [activeStay, stayDates]);

  async function requestHousekeeping(e) {
    e.preventDefault();
    if (!hkBookingId || !hkDate || !hkTime || hkBusy) return;
    setHkBusy(true);
    setHkMsg(null);
    try {
      await api.post(`/bookings/${hkBookingId}/housekeeping-request`, {
        date: hkDate,
        time: hkTime,
      });
      setHkMsg({ type: 'success', text: t('account.hkSuccess') });
      await refresh();
    } catch (err) {
      setHkMsg({
        type: 'error',
        text: err.response?.data?.error || err.message || t('account.hkFail'),
      });
    } finally {
      setHkBusy(false);
    }
  }

  if (!user) {
    return (
      <div>
        <Header />
        <main className="mx-auto max-w-md px-5 py-20 text-center">
          <h1 className="font-display text-3xl">{t('account.title')}</h1>
          <Link
            to="/sign-in"
            className="mt-6 inline-block rounded-full bg-ch-pine px-5 py-2 text-white"
          >
            {t('account.signIn')}
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  const displayName = user.full_name || user.email || t('common.guest');
  const unitSuffix = activeStay?.unit_number ? t('account.unitSuffix', { number: activeStay.unit_number }) : '';

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-ch px-5 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ch-muted">
              {t('account.yourAccount')}
            </p>
            <h1 className="mt-2 font-display text-4xl text-ch-pine">{t('account.hello', { name: displayName })}</h1>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded-full border border-ch-line px-5 py-2.5 text-sm font-semibold text-ch-pine transition hover:bg-ch-pine hover:text-white"
          >
            {t('account.logout')}
          </button>
        </div>

        <section className="mt-10 rounded-2xl border border-ch-line bg-white p-6">
          <h2 className="font-display text-2xl text-ch-pine">{t('account.pointsTitle')}</h2>
          <p className="mt-2 text-3xl font-semibold text-ch-pine">{money(points)}</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ch-muted">
            {t('account.pointsBody')}
          </p>
        </section>

        {activeStay && (
          <section className="mt-8 rounded-2xl border border-ch-line bg-white p-6">
            <h2 className="font-display text-2xl text-ch-pine">{t('account.hkTitle')}</h2>
            <p className="mt-2 text-sm text-ch-muted">
              {t('account.hkBody', { unit: unitSuffix })}
            </p>
            {activeStay.has_pending_housekeeping ? (
              <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {t('account.hkPending')}
              </p>
            ) : (
              <form onSubmit={requestHousekeeping} className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ch-muted">
                  {t('account.date')}
                  <select
                    value={hkDate}
                    onChange={(e) => setHkDate(e.target.value)}
                    className="rounded-xl border border-ch-line px-4 py-3 text-sm text-ch-pine"
                    required
                  >
                    {stayDates.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ch-muted">
                  {t('account.time')}
                  <select
                    value={hkTime}
                    onChange={(e) => setHkTime(e.target.value)}
                    className="rounded-xl border border-ch-line px-4 py-3 text-sm text-ch-pine"
                    required
                  >
                    {HOUSEKEEPING_TIMES.map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={hkBusy || !hkDate || !hkTime}
                    className="rounded-full bg-ch-pine px-6 py-3 text-sm font-semibold uppercase tracking-[0.12em] text-white disabled:opacity-50"
                  >
                    {hkBusy ? t('account.sending') : t('account.hkSubmit')}
                  </button>
                </div>
              </form>
            )}
            {hkMsg && (
              <p
                className={`mt-4 rounded-xl px-4 py-3 text-sm ${
                  hkMsg.type === 'success'
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                {hkMsg.text}
              </p>
            )}
            {Number(activeStay.guest_housekeeping_count) > 0 && (
              <p className="mt-3 text-xs text-ch-muted">
                {t('account.hkExtra', { count: activeStay.guest_housekeeping_count })}
              </p>
            )}
          </section>
        )}

        <section className="mt-10">
          <h2 className="font-display text-2xl text-ch-pine">{t('account.history')}</h2>
          <div className="mt-4 space-y-3">
            {loading && (
              <div className="flex justify-center py-8">
                <BrandLoader size="sm" label={t('common.loading')} />
              </div>
            )}
            {!loading &&
              trips.map((trip) => (
                <div key={trip.id} className="rounded-xl border border-ch-line p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-ch-pine">
                        {trip.listing_title || trip.unit_title || t('account.stay')}
                      </div>
                      <div className="mt-1 text-sm text-ch-muted">
                        {String(trip.checkin).slice(0, 10)} → {String(trip.checkout).slice(0, 10)}
                        {trip.unit_number ? ` · ${t('account.unit', { number: trip.unit_number })}` : ''}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <span className="rounded-full bg-ch-fog px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-ch-pine">
                        {trip.status}
                      </span>
                      {trip.is_current_stay && (
                        <div className="mt-2 text-xs font-semibold text-emerald-700">{t('account.currentStay')}</div>
                      )}
                    </div>
                  </div>
                  {Number(trip.total_egp) > 0 && (
                    <p className="mt-2 text-xs text-ch-muted">
                      {t('account.totalPoints', {
                        amount: money(trip.total_egp),
                        points: money(Math.round(Number(trip.total_egp) || 0)),
                      })}
                    </p>
                  )}
                </div>
              ))}
            {!loading && !trips.length && (
              <p className="text-sm text-ch-muted">{t('account.emptyTrips')}</p>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export function WishlistPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const { items, remove } = useWishlist();

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-ch px-5 py-10">
        <h1 className="font-display text-4xl text-ch-pine">{t('account.wishlist')}</h1>
        {!user && items.length > 0 && (
          <p className="mt-2 text-sm text-ch-muted">
            {t('account.savedOnDevice')}{' '}
            <Link to="/sign-in" className="font-semibold text-ch-pine underline">
              {t('auth.signIn')}
            </Link>{' '}
            {t('account.toSyncAcrossDevices')}
          </p>
        )}
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((u) => (
            <div key={getListingWpId(u) || u.slug} className="flex flex-col gap-2">
              <ListingCard listing={u} wishlistMode onRemove={() => remove(u)} />
              <button
                type="button"
                onClick={() => remove(u)}
                className="text-sm font-semibold text-ch-muted transition hover:text-[#e0245e]"
              >
                {t('account.removeWishlist')}
              </button>
            </div>
          ))}
          {!items.length && (
            <p className="col-span-full text-ch-muted">
              {t('account.wishlistEmpty')}
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
