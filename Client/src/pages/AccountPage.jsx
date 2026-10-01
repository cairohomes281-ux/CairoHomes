import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import api from '../api/http';
import ListingCard from '../components/ListingCard';
import { getListingWpId, useWishlist } from '../hooks/useWishlist';
import BrandLoader from '../components/ui/BrandLoader';

function money(n) {
  return Number(n || 0).toLocaleString('en-EG');
}

export default function AccountPage() {
  const { t } = useLocale();
  const { user, signOut } = useAuth();
  const [trips, setTrips] = useState([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);

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
