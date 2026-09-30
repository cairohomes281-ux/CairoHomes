/**
 * Cairo Homes brand mark — arched window with the rising sun over the dunes.
 * Drawn with currentColor so it adapts to light and dark surfaces.
 */
export function LogoMark({ className = 'h-10 w-auto', strokeWidth = 3, title = 'Cairo Homes' }) {
  return (
    <svg viewBox="0 0 100 120" fill="none" className={className} role="img" aria-label={title}>
      <g stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 118 V50 A40 40 0 0 1 90 50 V118 Z" />
        <circle cx="50" cy="50" r="12" />
        <path d="M38 50 H10 M62 50 H90 M50 38 V10 M41.5 41.5 L21.7 21.7 M58.5 41.5 L78.3 21.7 M39.6 44 L15.4 30 M60.4 44 L84.6 30 M44 39.6 L30 15.4 M56 39.6 L70 15.4" />
        <path d="M39.6 56 L10 73 M60.4 56 L90 73 M50 62 V74" />
        <path d="M10 80 Q45 62 90 92" />
        <path d="M10 94 Q45 78 90 108" />
        <path d="M26 118 Q55 98 90 118" />
      </g>
    </svg>
  );
}

/** Mark + bilingual wordmark, laid out like the official logo lock-up. */
export default function Logo({ className = '', markClassName = 'h-10 w-auto', compact = false, tone = 'dark' }) {
  const color = tone === 'light' ? 'text-ch-blush' : 'text-ch-pine';
  return (
    <span className={`inline-flex items-center gap-3 ${color} ${className}`}>
      <LogoMark className={markClassName} />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-brand text-[1.15rem] tracking-[0.18em] uppercase">Cairo Homes</span>
          <span className="mt-1 font-arabic-display text-[0.72rem] tracking-normal opacity-80" dir="rtl">
            بيوت القاهرة
          </span>
        </span>
      )}
    </span>
  );
}
