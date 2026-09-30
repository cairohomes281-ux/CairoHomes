import { LogoMark } from '../brand/Logo';

/** Inner-page opener: editorial title on the left, optional arch-framed photo on the right. */
export default function PageHero({ eyebrow, title, titleEm, body, image, imageAlt = '', children, compact = false }) {
  return (
    <section className="ch-grain relative overflow-hidden bg-ch-rose/50">
      <LogoMark
        className="pointer-events-none absolute -end-16 -top-10 h-[26rem] w-auto text-ch-pine/[0.05]"
        strokeWidth={1.4}
      />
      <div
        className={`ch-container relative grid items-center gap-12 ${compact ? 'py-16 md:py-20' : 'py-16 md:py-24'} ${
          image ? 'lg:grid-cols-[1.15fr_0.85fr]' : ''
        }`}
      >
        <div className="max-w-3xl">
          {eyebrow ? (
            <p className="ch-eyebrow ch-fade-up flex items-center gap-3 text-ch-clay">
              <span className="h-px w-8 bg-ch-clay/60" />
              {eyebrow}
            </p>
          ) : null}
          <h1
            className="ch-fade-up mt-6 font-display font-light leading-[0.98] tracking-[-0.015em] text-ch-pine-dark"
            style={{ fontSize: compact ? 'clamp(2.4rem, 5vw, 4rem)' : 'clamp(2.8rem, 6.4vw, 5.6rem)', animationDelay: '0.12s' }}
          >
            {title}
            {titleEm ? (
              <>
                {' '}
                <em className="font-normal italic text-ch-clay">{titleEm}</em>
              </>
            ) : null}
          </h1>
          {body ? (
            <p className="ch-lede ch-fade-up mt-7 max-w-xl" style={{ animationDelay: '0.24s' }}>
              {body}
            </p>
          ) : null}
          {children ? (
            <div className="ch-fade-up mt-9" style={{ animationDelay: '0.36s' }}>
              {children}
            </div>
          ) : null}
        </div>
        {image ? (
          <div className="relative mx-auto w-full max-w-sm lg:max-w-none">
            <div aria-hidden="true" className="ch-sun-rise absolute -end-4 -top-6 h-28 w-28 rounded-full bg-ch-blush" />
            <div className="ch-arch-outline relative">
              <div className="ch-arch ch-fade-in aspect-[4/4.6] bg-ch-sand">
                <img src={image} alt={imageAlt} className="ch-kenburns h-full w-full object-cover" />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
