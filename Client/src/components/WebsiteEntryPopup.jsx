import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import api from '../api/http';

const STORAGE_KEY = 'ch_site_popup_dismissed';

function shouldShowOnPath(pathname) {
  if (!pathname) return true;
  if (pathname.startsWith('/admin')) return false;
  if (pathname.startsWith('/sales')) return false;
  if (pathname.startsWith('/sign-in') || pathname.startsWith('/sign-up')) return false;
  if (pathname.startsWith('/checkout')) return false;
  return true;
}


export default function WebsiteEntryPopup() {
  const { pathname } = useLocation();
  const [popup, setPopup] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!shouldShowOnPath(pathname)) {
      setOpen(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const dismissed = sessionStorage.getItem(STORAGE_KEY);
        const { data } = await api.get('/site-popup');
        if (cancelled || !data?.image_url) {
          setPopup(null);
          setOpen(false);
          return;
        }
        setPopup(data);
        const stamp = String(data.updated_at || data.image_url);
        if (dismissed === stamp) {
          setOpen(false);
          return;
        }
        setOpen(true);
      } catch {
        if (!cancelled) {
          setPopup(null);
          setOpen(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const close = () => {
    if (popup) {
      try {
        sessionStorage.setItem(STORAGE_KEY, String(popup.updated_at || popup.image_url));
      } catch {}
    }
    setOpen(false);
  };

  if (!open || !popup?.image_url || typeof document === 'undefined') return null;

  const link = String(popup.link_url || '').trim();

  const image = (
    <img
      src={popup.image_url}
      alt="Promotion"
      className="block w-full h-auto max-h-[85vh] object-contain bg-black"
    />
  );

  const node = (
    <div
      className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-950/65 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Promotion"
      onClick={close}
    >
      <div
        className="relative w-full max-w-3xl overflow-hidden rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-900 shadow-md hover:bg-slate-100"
          aria-label="Close"
        >
          <X className="h-4 w-4" strokeWidth={2.5} />
        </button>

        {link ? (
          link.startsWith('http') ? (
            <a href={link} target="_blank" rel="noopener noreferrer" onClick={close}>
              {image}
            </a>
          ) : (
            <Link to={link} onClick={close}>
              {image}
            </Link>
          )
        ) : (
          image
        )}
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
