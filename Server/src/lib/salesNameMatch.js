

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|miss|mister|dr|prof)\.?\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Spreadsheet spellings that are the same sales person — first entry is canonical.
 * Keep in sync with Client/src/admin/utils/salesNameMatch.js.
 */
const EQUIVALENCE_GROUPS = [];

function aliasLabelsForName(value) {
  const n = normalizeName(value);
  if (!n) return [];
  for (const group of EQUIVALENCE_GROUPS) {
    if (group.includes(n)) return [...group];
  }
  return [n];
}

function titleCaseWords(value) {
  return String(value || '')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Canonical display label for spreadsheet / ops agent spellings (e.g. Kareem → Karim Fawzy). */
function canonicalSalesLabelFromLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const { canonicalOpsAgentFromLabel } = require('./opsAgentAliases');
    const ops = canonicalOpsAgentFromLabel(raw);
    if (ops) return ops;
  } catch (_) {}
  const n = normalizeName(raw);
  if (!n) return raw;
  for (const group of EQUIVALENCE_GROUPS) {
    if (group.includes(n)) return titleCaseWords(group[0]);
  }
  return raw;
}

function resolveSalesLabel(value) {
  return canonicalSalesLabelFromLabel(value) || String(value || '').trim() || null;
}

function namesAreAliases(a, b) {
  const left = new Set(aliasLabelsForName(a));
  if (!left.size) return false;
  return aliasLabelsForName(b).some((n) => left.has(n));
}

function tokens(value) {
  return normalizeName(value)
    .split(' ')
    .filter((t) => t.length > 1);
}

function levenshtein(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const rows = s.length + 1;
  const cols = t.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[s.length][t.length];
}


function stringSimilarity(a, b) {
  const s = normalizeName(a);
  const t = normalizeName(b);
  if (!s || !t) return 0;
  if (s === t) return 1;
  const dist = levenshtein(s, t);
  return 1 - dist / Math.max(s.length, t.length);
}


function nameMatchScore(salesLabel, staffName) {
  const label = normalizeName(salesLabel);
  const staff = normalizeName(staffName);
  if (!label || !staff) return 0;
  if (/^owner\b/.test(label)) return 0;
  if (label === staff) return 1;
  if (namesAreAliases(label, staff)) return 1;

  const labelTokens = tokens(label);
  const staffTokens = tokens(staff);
  if (!labelTokens.length || !staffTokens.length) return stringSimilarity(label, staff);

  // Single-token labels (e.g. "Youssef" or "Mr Youssef" after dropping Mr)
  // must not match a different person who only shares that given name.
  if (labelTokens.length === 1 && staffTokens.length >= 2) {
    return 0;
  }
  if (staffTokens.length === 1 && labelTokens.length >= 2) {
    return 0;
  }

  // Shared first names are not enough: Youssef Hamdy ≠ Youssef Ragab.
  if (labelTokens.length >= 2 && staffTokens.length >= 2) {
    const labelSurnames = labelTokens.slice(1);
    const staffSurnames = staffTokens.slice(1);
    const surnameHit = labelSurnames.some((lt) =>
      staffSurnames.some((st) => stringSimilarity(lt, st) >= 0.82)
    );
    if (!surnameHit) return 0;
  }

  const direct = stringSimilarity(label, staff);

  const sortedLabel = [...labelTokens].sort().join(' ');
  const sortedStaff = [...staffTokens].sort().join(' ');
  const sortedScore = stringSimilarity(sortedLabel, sortedStaff);

  let tokenHits = 0;
  let worstStaffToken = 1;
  for (const st of staffTokens) {
    let best = 0;
    for (const lt of labelTokens) {
      best = Math.max(best, stringSimilarity(st, lt));
    }
    worstStaffToken = Math.min(worstStaffToken, best);
    if (best >= 0.8) tokenHits += 1;
  }
  const tokenCoverage = tokenHits / staffTokens.length;

  // Full-string containment only when both sides have the same token count
  // (avoids "Hamdy" ⊂ "Youssef Hamdy").
  const contained =
    labelTokens.length === staffTokens.length && (label.includes(staff) || staff.includes(label))
      ? 0.94
      : staffTokens.length >= 2 && labelTokens.length >= 2 && tokenCoverage >= 1
        ? 0.9
        : 0;

  let score = Math.max(direct, sortedScore, tokenCoverage * 0.95, contained);

  if (labelTokens.length < staffTokens.length) {
    let labelHits = 0;
    for (const lt of labelTokens) {
      let best = 0;
      for (const st of staffTokens) best = Math.max(best, stringSimilarity(lt, st));
      if (best >= 0.82) labelHits += 1;
    }
    score = Math.max(score, (labelHits / labelTokens.length) * 0.9);
  } else if (staffTokens.length >= 2 && worstStaffToken < 0.78) {
    score = Math.min(score, 0.7);
  }

  return score;
}

const DEFAULT_MIN_SCORE = 0.74;


function matchSalesLabelToStaff(salesLabel, staffList, { minScore = DEFAULT_MIN_SCORE } = {}) {
  const label = String(salesLabel || '').trim();
  if (!label || /^owner$/i.test(label)) return null;

  const ranked = (staffList || [])
    .map((staff) => ({
      staff,
      score: nameMatchScore(label, staff.full_name || staff.name || ''),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score);

  if (!ranked.length) return null;

  
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 0.05 && ranked[1].score >= minScore) {
    return null;
  }

  return ranked[0];
}


function salesLabelBelongsToUser(salesLabel, user, { minScore = DEFAULT_MIN_SCORE } = {}) {
  if (!user?.full_name) return false;
  return nameMatchScore(salesLabel, user.full_name) >= minScore;
}

/** Official assignee wins; otherwise credit the sales-label match used on reservation records. */
function resolveReservationSalesPerson(reservation, staffList) {
  const id = reservation?.sales_person_id;
  if (id != null && String(id).trim() !== '') {
    const byId = (staffList || []).find((s) => String(s.id) === String(id));
    if (byId) return byId;
  }
  return matchSalesLabelToStaff(reservation?.sales_label, staffList)?.staff || null;
}

module.exports = {
  normalizeName,
  aliasLabelsForName,
  namesAreAliases,
  nameMatchScore,
  matchSalesLabelToStaff,
  salesLabelBelongsToUser,
  resolveReservationSalesPerson,
  canonicalSalesLabelFromLabel,
  resolveSalesLabel,
  DEFAULT_MIN_SCORE,
};
