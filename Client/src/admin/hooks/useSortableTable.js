import { useState, useMemo } from 'react';


export function useSortableTable(data = [], defaultKey = '', defaultDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      
      const isDateStr = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      const isNum = !isNaN(an) && !isNaN(bn) && !isDateStr(av) && !isDateStr(bv);
      const cmp = isNum
        ? an - bn
        : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  return { sorted, sortKey, sortDir, handleSort };
}
