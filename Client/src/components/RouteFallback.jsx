import BrandLoader from './ui/BrandLoader';

/** Guest route/chunk Suspense fallback. Skips branding on /admin (admin has its own spinner). */
export default function RouteFallback() {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-sm text-gray-400" role="status">
        Loading…
      </div>
    );
  }

  return <BrandLoader fullPage size="lg" />;
}
