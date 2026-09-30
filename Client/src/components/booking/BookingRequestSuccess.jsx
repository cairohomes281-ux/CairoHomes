import { Check, Smile } from 'lucide-react';


export default function BookingRequestSuccess({
  title,
  description,
  note,
  primaryLabel,
  onPrimary,
  primaryTo,
  secondaryLabel,
  secondaryTo,
  LinkComponent,
}) {
  const PrimaryTag = primaryTo && LinkComponent ? LinkComponent : 'button';
  const primaryProps =
    PrimaryTag === 'button'
      ? { type: 'button', onClick: onPrimary }
      : { to: primaryTo };

  return (
    <main className="relative flex min-h-[72vh] flex-col items-center justify-center overflow-hidden px-4 py-16 text-center">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(900px 420px at 50% 18%, rgba(181, 114, 90, 0.16), transparent 58%), radial-gradient(700px 380px at 80% 90%, rgba(47, 93, 88, 0.08), transparent 55%), linear-gradient(180deg, #fff8f0 0%, #fcf5f1 42%, #ffffff 100%)',
        }}
      />

      <div className="relative z-[1] w-full max-w-lg">
        <div className="flex items-end justify-center gap-3 sm:gap-4" aria-hidden>
          <div className="ch-success-pop relative flex h-24 w-24 items-center justify-center sm:h-28 sm:w-28">
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle at 35% 30%, #ffe8cc, #b5725a 72%)',
                boxShadow: '0 18px 40px rgba(181, 114, 90, 0.28)',
              }}
            />
            <span className="absolute inset-[7px] rounded-full bg-white" />
            <Check className="relative h-12 w-12 text-[#b5725a] sm:h-14 sm:w-14" strokeWidth={2.75} />
          </div>

          <div className="ch-success-pop-delay relative mb-1 flex h-16 w-16 items-center justify-center sm:mb-2 sm:h-20 sm:w-20">
            <span
              className="absolute inset-0 rounded-full bg-ch-pine"
              style={{ boxShadow: '0 14px 28px rgba(47, 93, 88, 0.22)' }}
            />
            <Smile className="relative h-9 w-9 text-[#ffe8cc] sm:h-10 sm:w-10" strokeWidth={2.2} />
          </div>
        </div>

        <h1 className="ch-success-fade mt-8 font-display text-3xl font-semibold tracking-tight text-ch-pine sm:text-4xl">
          {title}
        </h1>

        {description ? (
          <p className="ch-success-fade mt-4 text-base leading-relaxed text-ch-pine/90 sm:text-lg">
            {description}
          </p>
        ) : null}

        {note ? (
          <p className="ch-success-fade mt-3 text-sm leading-relaxed text-ch-muted">{note}</p>
        ) : null}

        <div className="ch-success-fade mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <PrimaryTag
            {...primaryProps}
            className="inline-flex min-w-[12rem] items-center justify-center rounded-full bg-ch-pine px-7 py-3.5 text-sm font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-ch-pine-dark"
          >
            {primaryLabel}
          </PrimaryTag>

          {secondaryLabel && secondaryTo && LinkComponent ? (
            <LinkComponent
              to={secondaryTo}
              className="inline-flex min-w-[12rem] items-center justify-center rounded-full border border-ch-line bg-white/80 px-7 py-3.5 text-sm font-semibold text-ch-pine transition-colors hover:border-ch-pine/40"
            >
              {secondaryLabel}
            </LinkComponent>
          ) : null}
        </div>
      </div>
    </main>
  );
}
