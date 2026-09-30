import { useLocation } from 'react-router-dom';
import { whatsappHref, listingWhatsAppMessage } from '../../theme/brand';
import { useLocale } from '../../context/LocaleContext';


export default function WhatsAppFAB({ message }) {
  const { pathname } = useLocation();
  const { t } = useLocale();

  if (pathname.startsWith('/admin') || pathname.startsWith('/sales')) {
    return null;
  }

  const text =
    message !== undefined
      ? message
      : pathname.startsWith('/listings/')
        ? listingWhatsAppMessage(pathname)
        : undefined;
  const href = whatsappHref(text);
  const label = t('fab.whatsapp');

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className="group fixed bottom-5 end-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-ch-pine shadow-[0_18px_40px_-12px_rgba(16,33,31,0.55)] ring-4 ring-ch-blush/50 transition duration-500 hover:bg-ch-pine-dark hover:ring-ch-blush md:bottom-6 md:end-6 md:h-[60px] md:w-[60px]"
    >
      <span className="absolute end-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-ch-ivory bg-[#25d366]" aria-hidden="true" />
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="text-ch-blush transition-transform duration-500 group-hover:scale-110"
        aria-hidden="true"
      >
        <path d="M20.52 3.48A11.94 11.94 0 0012.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.36-1.66a11.86 11.86 0 005.68 1.45h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.23-6.15-3.39-8.45zM12.05 21.79h-.01a9.86 9.86 0 01-5.03-1.38l-.36-.21-3.77.99 1.01-3.68-.24-.38a9.84 9.84 0 01-1.51-5.26c0-5.44 4.43-9.87 9.88-9.87 2.64 0 5.12 1.03 6.98 2.9a9.81 9.81 0 012.89 6.98c0 5.44-4.43 9.87-9.84 9.87zm5.41-7.39c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.34.22-.64.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.76-1.66-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.34.45-.51.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5l-.57-.01a1.1 1.1 0 00-.79.37c-.27.3-1.04 1.01-1.04 2.47s1.07 2.87 1.21 3.07c.15.2 2.1 3.21 5.08 4.5.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.42.25-.7.25-1.29.17-1.42-.07-.13-.27-.2-.57-.35z" />
      </svg>
    </a>
  );
}
