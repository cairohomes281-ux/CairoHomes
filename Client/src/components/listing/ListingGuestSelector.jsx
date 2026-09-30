import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';


export default function ListingGuestSelector({ value, onChange, onClose, anchorRef, max = 8 }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const cap = max > 0 ? max : 8;

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!isMobile) return undefined;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = orig;
    };
  }, [isMobile]);

  useEffect(() => {
    if (isMobile || !anchorRef?.current) return undefined;
    const place = () => {
      const r = anchorRef.current.getBoundingClientRect();
      const width = 360;
      setPos({
        top: r.bottom + 8,
        left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place);
    };
  }, [anchorRef, isMobile]);

  useEffect(() => {
    const onClick = (e) => {
      if (
        popRef.current &&
        !popRef.current.contains(e.target) &&
        anchorRef?.current &&
        !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorRef]);

  function bump(key, delta) {
    const next = { ...value, [key]: value[key] + delta };
    if (next.adults < 1) return;
    if (next.children < 0 || next.infants < 0) return;
    if (key !== 'infants' && next.adults + next.children > cap) return;
    if (key === 'infants' && next.infants > 5) return;
    onChange(next);
  }

  if (typeof document === 'undefined') return null;
  if (!isMobile && !pos) return null;

  const rows = [
    { key: 'adults', label: 'Adults', hint: 'Ages 15+' },
    { key: 'children', label: 'Children', hint: 'Ages 12–14' },
    { key: 'infants', label: 'Infants', hint: 'Under 12' },
  ];

  return createPortal(
    <>
      {isMobile && (
        <div className="fixed inset-0 z-[219] bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      )}
      <div
        ref={popRef}
        className={
          isMobile
            ? 'fixed inset-x-0 bottom-0 bg-white border-t border-ch-line rounded-t-[22px] shadow-2xl z-[220] p-5 pb-[max(20px,env(safe-area-inset-bottom))]'
            : 'fixed bg-white border border-ch-line rounded-[14px] shadow-2xl z-[220] p-4 min-w-[340px] max-w-[calc(100vw-32px)]'
        }
        style={isMobile ? undefined : { top: pos.top, left: pos.left }}
      >
        <div className="flex items-center justify-between mb-3">
          <strong className="text-sm text-ch-pine">Guests</strong>
          <button type="button" onClick={onClose} className="text-xs font-semibold text-ch-pine">
            Done
          </button>
        </div>
        <div className="space-y-3.5">
          {rows.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-ch-pine">{label}</div>
                <div className="text-[12px] text-ch-muted">{hint}</div>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => bump(key, -1)}
                  className="w-8 h-8 rounded-full border border-ch-line text-ch-pine disabled:opacity-30"
                  disabled={key === 'adults' ? value.adults <= 1 : value[key] <= 0}
                >
                  −
                </button>
                <span className="w-5 text-center text-sm font-semibold">{value[key]}</span>
                <button
                  type="button"
                  onClick={() => bump(key, 1)}
                  className="w-8 h-8 rounded-full border border-ch-line text-ch-pine"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body
  );
}
