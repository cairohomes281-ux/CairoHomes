function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|mister|dr|prof)\.?/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Spreadsheet spellings that are the same sales person — first entry is canonical. */
const EQUIVALENCE_GROUPS = [];

function aliasLabelsForName(value) {
  const n = normalizeName(value);
  if (!n) return [];
  for (const group of EQUIVALENCE_GROUPS) {
    if (group.includes(n)) return [...group];
  }
  return [n];
}

export function namesAreAliases(a, b) {
  const left = new Set(aliasLabelsForName(a));
  if (!left.size) return false;
  return aliasLabelsForName(b).some((n) => left.has(n));
}

export function canonicalSalesName(value, staffList = []) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const staff = (staffList || []).find((u) => namesAreAliases(u.full_name, raw));
  if (staff?.full_name) return String(staff.full_name).trim();
  const n = normalizeName(raw);
  for (const group of EQUIVALENCE_GROUPS) {
    if (group.includes(n)) {
      return group[0]
        .split(' ')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }
  return raw;
}

export function reservationSalesDisplay(reservation, staffList = [], empty = '—') {
  if (!reservation) return empty;
  if (reservation.sales_owner_label) return reservation.sales_owner_label;
  if (reservation.is_owner_reservation) return 'Owner';
  return canonicalSalesName(
    reservation.sales_person_name || reservation.sales_label,
    staffList
  ) || empty;
}
