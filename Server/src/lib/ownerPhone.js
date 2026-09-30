
function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}


function normalizeOwnerPhone(raw) {
  let d = digitsOnly(raw);
  if (!d) return null;

  
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length >= 11) d = d.slice(2);

  
  if (d.length === 10 && d.startsWith('1')) d = `0${d}`;

  
  if (/^01\d{9}$/.test(d)) return d;

  
  if (d.length >= 8 && d.length <= 15) return d;

  return null;
}


function ownerPhoneLoginVariants(raw) {
  const canonical = normalizeOwnerPhone(raw);
  if (!canonical) return [];
  const set = new Set([canonical, digitsOnly(raw)].filter(Boolean));

  if (/^01\d{9}$/.test(canonical)) {
    set.add(canonical.slice(1)); 
    set.add(`20${canonical.slice(1)}`); 
    set.add(`+20${canonical.slice(1)}`);
    set.add(`0020${canonical.slice(1)}`);
  }

  return [...set];
}

module.exports = {
  digitsOnly,
  normalizeOwnerPhone,
  ownerPhoneLoginVariants,
};
