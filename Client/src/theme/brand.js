// Contact details below are placeholders — set the VITE_* env vars (Client/.env) before launch.
export const brand = {
  id: 'cairo-homes',
  name: 'Cairo Homes',
  nameAr: 'بيوت القاهرة',
  tagline: 'Cairo, hosted beautifully.',
  domain: import.meta.env.VITE_SITE_URL || 'https://cairohomes.com',
  colors: {
    primary: '#2f5d58',
    blush: '#e9cfc2',
    rose: '#fee8e2',
    accent: '#b5725a',
    muted: '#5e7470',
  },
  whatsapp: import.meta.env.VITE_WHATSAPP_NUMBER || '+201000000000',
  phoneDisplay: import.meta.env.VITE_PHONE_DISPLAY || '+20 100 000 0000',
  email: import.meta.env.VITE_CONTACT_EMAIL || 'info@cairohomes.com',
  address: import.meta.env.VITE_ADDRESS || 'Zamalek, Cairo, Egypt',
  mapsUrl: import.meta.env.VITE_MAPS_URL || 'https://maps.google.com/?q=Zamalek,Cairo',
  social: {
    facebook: 'https://www.facebook.com/cairohomes/',
    instagram: 'https://www.instagram.com/cairohomes/',
  },
  copyright: `© ${new Date().getFullYear()} Cairo Homes Hospitality. All rights reserved.`,
};


export function whatsappHref(text) {
  const n = brand.whatsapp.replace(/\D/g, '');
  const base = `https://wa.me/${n}`;
  const message = text === undefined ? 'Hi Cairo Homes — I have a question' : text;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}


export function listingWhatsAppMessage(pathnameOrUrl) {
  const raw = String(pathnameOrUrl || '').trim();
  if (!raw) return 'Hi Cairo Homes — I have a question';

  let listingUrl = raw;
  if (raw.startsWith('/')) {
    const base = String(brand.domain || '').replace(/\/$/, '');
    listingUrl = `${base}${raw}`;
  } else if (!/^https?:\/\//i.test(raw) && typeof window !== 'undefined') {
    listingUrl = `${window.location.origin}${raw.startsWith('/') ? raw : `/${raw}`}`;
  }

  if (!/\/listings\//i.test(listingUrl)) {
    return 'Hi Cairo Homes — I have a question';
  }

  return `${listingUrl}\nعندي استفسار بخصوص الوحده دي`;
}
