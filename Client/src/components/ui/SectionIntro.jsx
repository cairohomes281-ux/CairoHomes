import Reveal from './Reveal';

/** Eyebrow + editorial serif title (+ optional lede), used to open guest sections. */
export default function SectionIntro({
  eyebrow,
  title,
  titleEm,
  body,
  align = 'start',
  tone = 'dark',
  className = '',
}) {
  const centered = align === 'center';
  const light = tone === 'light';
  return (
    <Reveal className={`${centered ? 'mx-auto text-center' : ''} max-w-3xl ${className}`}>
      {eyebrow ? (
        <p
          className={`ch-eyebrow flex items-center gap-3 ${centered ? 'justify-center' : ''} ${
            light ? 'text-ch-blush' : 'text-ch-clay'
          }`}
        >
          <span className={`h-px w-8 ${light ? 'bg-ch-blush/60' : 'bg-ch-clay/60'}`} />
          {eyebrow}
        </p>
      ) : null}
      <h2
        className={`mt-5 text-[2.3rem] leading-[1.05] md:text-[3.4rem] ${light ? 'text-ch-ivory' : 'text-ch-pine-dark'}`}
      >
        {title}
        {titleEm ? (
          <>
            {' '}
            <em className={`font-light italic ${light ? 'text-ch-blush' : 'text-ch-clay'}`}>{titleEm}</em>
          </>
        ) : null}
      </h2>
      {body ? (
        <p className={`mt-6 ${light ? 'text-[16px] leading-[1.8] text-ch-ivory/75' : 'ch-lede'} ${centered ? 'mx-auto' : ''} max-w-2xl`}>
          {body}
        </p>
      ) : null}
    </Reveal>
  );
}
