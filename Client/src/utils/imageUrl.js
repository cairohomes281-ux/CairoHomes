
export function optimizeImageUrl(url, { width = 800, quality = 'auto' } = {}) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('/') || url.startsWith('data:')) return url;

  try {
    const u = new URL(url);
    if (!u.hostname.includes('res.cloudinary.com')) return url;

    const marker = '/upload/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return url;

    const after = u.pathname.slice(idx + marker.length);
    
    if (/^(f_|q_|w_|c_|h_|dpr_)/.test(after) || after.includes('/f_auto') || after.includes(',w_')) {
      return url;
    }

    const transform = `f_auto,q_${quality},w_${width},c_limit`;
    u.pathname = `${u.pathname.slice(0, idx + marker.length)}${transform}/${after}`;
    return u.toString();
  } catch {
    return url;
  }
}
