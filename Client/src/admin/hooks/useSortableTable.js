import { useState, useMemo } from 'react';

function timeValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const parsed = Date.parse(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(parsed) ? null : parsed;
}

function tie(a, b) {
  const ai = Number(a?.id);
  const bi = Number(b?.id);
  if (!Number.isFinite(ai) || !Number.isFinite(bi)) return 0;
  return ai - bi;
}

export function useSortableTable(data = [], defaultKey = '', defaultDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) {
        const same = tie(a, b);
        return sortDir === 'asc' ? same : -same;
      }
      if (av == null) return 1;
      if (bv == null) return -1;

      const at = timeValue(av);
      const bt = timeValue(bv);
      let cmp;
      if (at != null && bt != null) cmp = at - bt;
      else {
        const an = parseFloat(av);
        const bn = parseFloat(bv);
        const isNum = !Number.isNaN(an) && !Number.isNaN(bn) && String(av).trim() !== '' && String(bv).trim() !== '';
        cmp = isNum
          ? an - bn
          : String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true });
      }
      if (cmp === 0) cmp = tie(a, b);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  return { sorted, sortKey, sortDir, handleSort };
}
