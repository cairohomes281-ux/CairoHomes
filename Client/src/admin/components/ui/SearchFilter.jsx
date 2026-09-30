import { Search } from 'lucide-react';

export default function SearchFilter({ value, onChange, placeholder = 'Search...', children }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-5">
      <div className="relative flex-1 min-w-48">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="input pl-9"
        />
      </div>
      {children}
    </div>
  );
}
