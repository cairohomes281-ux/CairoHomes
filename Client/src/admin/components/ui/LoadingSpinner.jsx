export default function LoadingSpinner({ size = 'md', center = true }) {
  const sizes = { sm: 'w-5 h-5', md: 'w-8 h-8', lg: 'w-12 h-12' };
  const spinner = (
    <div className={`${sizes[size]} border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin`} />
  );
  if (center) return <div className="flex items-center justify-center py-12">{spinner}</div>;
  return spinner;
}
