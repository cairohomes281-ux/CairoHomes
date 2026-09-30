import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';


export default function SortTh({ col, sortKey, sortDir, onSort, children, className = '' }) {
  const active = sortKey === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`cursor-pointer select-none whitespace-nowrap hover:bg-gray-100 transition-colors ${active ? 'text-primary-700' : ''} ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active
          ? sortDir === 'asc'
            ? <ChevronUp   className="w-3 h-3 text-primary-600 flex-shrink-0" />
            : <ChevronDown className="w-3 h-3 text-primary-600 flex-shrink-0" />
          : <ChevronsUpDown className="w-3 h-3 text-gray-300 flex-shrink-0" />
        }
      </span>
    </th>
  );
}
