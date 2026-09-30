import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';


export default function AdminReservationDrawer({
  open,
  onClose,
  title = 'New Reservation',
  subtitle = 'Cash or InstaPay · pending until payment is collected',
  children,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-5">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        aria-label="Close reservation form"
        onClick={onClose}
      />
      <section className="relative flex max-h-[94dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-[16px] border border-[#e6ebf2] bg-white shadow-2xl">
        <header className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-[#e6ebf2] px-5 py-4 sm:px-6">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-[#0f1c2e]">
              {title}
            </h2>
            {subtitle ? <p className="mt-1 text-sm text-[#5b6b80]">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] p-1.5 text-[#5b6b80] hover:bg-[#f6f8fb] hover:text-[#0f1c2e]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </section>
    </div>,
    document.body
  );
}
