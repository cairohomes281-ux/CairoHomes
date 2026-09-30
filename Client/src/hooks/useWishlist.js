import { useCallback, useEffect, useState } from 'react';
import api from '../api/http';
import { useAuth } from '../context/AuthContext';

const LOCAL_KEY = 'ch_wishlist';

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeLocal(items) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
}

export function getListingWpId(listing) {
  return Number(listing?.wp_post_id || listing?.listing_wp_id || 0) || null;
}

export function useWishlist() {
  const { user } = useAuth();
  const [ids, setIds] = useState(() => new Set());
  const [items, setItems] = useState([]);

  const loadItems = useCallback(async () => {
    if (user) {
      const r = await api.get('/wishlist');
      const list = r.data.items || [];
      setItems(list);
      setIds(new Set(list.map((x) => Number(x.listing_wp_id)).filter(Boolean)));
      return;
    }

    const local = readLocal();
    setItems(local);
    setIds(new Set(local.map((x) => getListingWpId(x)).filter(Boolean)));
  }, [user]);

  useEffect(() => {
    loadItems().catch(() => {});
  }, [loadItems]);

  const has = useCallback((wpPostId) => ids.has(Number(wpPostId)), [ids]);

  const remove = useCallback(
    async (listing) => {
      const wpId = getListingWpId(listing);
      if (!wpId || !ids.has(wpId)) return;

      setIds((prev) => {
        const next = new Set(prev);
        next.delete(wpId);
        return next;
      });
      setItems((prev) => prev.filter((x) => getListingWpId(x) !== wpId));

      if (user) {
        try {
          await api.delete(`/wishlist/${wpId}`);
        } catch {
          await loadItems();
        }
        return;
      }

      writeLocal(readLocal().filter((x) => getListingWpId(x) !== wpId));
    },
    [ids, user, loadItems]
  );

  const toggle = useCallback(
    async (listing) => {
      const wpId = getListingWpId(listing);
      if (!wpId) return;
      const exists = ids.has(wpId);

      setIds((prev) => {
        const next = new Set(prev);
        if (exists) next.delete(wpId);
        else next.add(wpId);
        return next;
      });
      setItems((prev) => {
        if (exists) return prev.filter((x) => getListingWpId(x) !== wpId);
        return [...prev, { ...listing, listing_wp_id: wpId, wp_post_id: wpId }];
      });

      if (user) {
        try {
          if (exists) await api.delete(`/wishlist/${wpId}`);
          else await api.post('/wishlist', { listing_wp_id: wpId, listing_slug: listing.slug });
        } catch {
          await loadItems();
        }
        return;
      }

      const local = readLocal();
      if (exists) writeLocal(local.filter((x) => getListingWpId(x) !== wpId));
      else writeLocal([...local, { listing_wp_id: wpId, listing_slug: listing.slug, ...listing }]);
    },
    [ids, user, loadItems]
  );

  return { has, toggle, remove, items, ids, refresh: loadItems };
}
