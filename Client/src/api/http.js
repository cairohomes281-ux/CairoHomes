import axios from 'axios';
import { reportApiError } from '../utils/siteTelemetry';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    reportApiError(err);
    return Promise.reject(err);
  }
);

api.interceptors.request.use((config) => {
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    if (config.headers) delete config.headers['Content-Type'];
  }
  const token = localStorage.getItem('ch_guest_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const staff = localStorage.getItem('ch_sales_token');
  if (staff && config.url?.startsWith('/sales')) {
    config.headers.Authorization = `Bearer ${staff}`;
  }
  return config;
});

export async function validatePromoCode({ code, amount, email, phone, unitId, slug }) {
  const { data } = await api.post('/promo-codes/validate', {
    code,
    amount,
    email,
    phone,
    unit_id: unitId,
    slug,
  });
  if (!data?.valid) throw new Error(data?.error || 'Invalid promo code');
  return {
    code: data.code,
    percentage: Number(data.discount_percent || 0),
    discountAmount: Number(data.discount_amount || data.discount_amount_applied || 0),
    discountedTotal: data.discounted_total,
  };
}

export async function createBookingCheckout(payload) {
  const { data } = await api.post('/bookings/checkout', payload);
  return data;
}

export async function fetchUnitReviews(unitIdOrSlug) {
  const { data } = await api.get(`/units/${unitIdOrSlug}/reviews`);
  return data;
}

export async function createUnitReview(unitIdOrSlug, payload) {
  const { data } = await api.post(`/reviews/unit/${unitIdOrSlug}`, payload);
  return data;
}

export default api;
