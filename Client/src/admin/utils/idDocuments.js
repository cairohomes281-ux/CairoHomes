
export function isPdfUrl(url) {
  const s = String(url || '');
  if (!s) return false;
  if (/\.pdf($|\?)/i.test(s)) return true;
  if (/\/raw\/upload\//i.test(s)) return true;
  if (/\/upload\/.*\.pdf/i.test(s)) return true;
  return false;
}


export function idDocumentPagePreviewUrl(url, page = 1) {
  const s = String(url || '');
  if (!s || !isPdfUrl(s)) return null;
  if (/\/raw\/upload\//i.test(s)) return null;

  const pg = Math.max(1, Number(page) || 1);
  if (/\/image\/upload\//i.test(s)) {
    return s
      .replace('/image/upload/', `/image/upload/f_jpg,pg_${pg},q_auto:best,c_limit,w_1600/`)
      .replace(/\.pdf($|\?)/i, '.jpg$1');
  }

  
  if (/\.pdf($|\?)/i.test(s)) {
    return s.replace(/\.pdf($|\?)/i, '.jpg$1');
  }
  return null;
}


export function idDocumentThumbUrl(url) {
  if (!isPdfUrl(url)) return url;
  return idDocumentPagePreviewUrl(url, 1) || url;
}
