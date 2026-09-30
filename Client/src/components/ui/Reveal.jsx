import { useEffect, useRef, useState } from 'react';

/** Fades/lifts children into view once, when they scroll past the fold. */
export default function Reveal({
  as: Tag = 'div',
  delay = 0,
  mask = false,
  className = '',
  style,
  children,
  ...rest
}) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (mask) {
    // A fully clipped element never reports as intersecting, so observe the wrapper and clip the inner layer.
    return (
      <Tag ref={ref} className={className} style={style} {...rest}>
        <div className={`ch-mask-reveal h-full w-full ${shown ? 'is-in' : ''}`} style={{ '--reveal-delay': `${delay}ms` }}>
          {children}
        </div>
      </Tag>
    );
  }

  return (
    <Tag
      ref={ref}
      className={`ch-reveal ${shown ? 'is-in' : ''} ${className}`}
      style={{ '--reveal-delay': `${delay}ms`, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
