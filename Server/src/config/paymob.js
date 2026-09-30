const https = require('https');
const crypto = require('crypto');

const BASE = process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com/api';

function requestJson(method, path, body, headers = {}) {
  const url = new URL(path.startsWith('http') ? path : `${BASE}${path}`);
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, data });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getAuthToken() {
  const { data, status } = await requestJson('POST', '/auth/tokens', {
    api_key: process.env.PAYMOB_API_KEY,
  });
  if (status >= 400 || !data?.token) {
    throw new Error(`Paymob auth failed: ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function createOrder(token, { amountCents, merchantOrderId, currency = 'EGP' }) {
  const { data, status } = await requestJson('POST', '/ecommerce/orders', {
    auth_token: token,
    delivery_needed: false,
    amount_cents: amountCents,
    currency,
    merchant_order_id: merchantOrderId,
    items: [],
  });
  if (status >= 400 || !data?.id) {
    throw new Error(`Paymob order failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function createPaymentKey(token, orderId, { amountCents, billing, currency = 'EGP' }) {
  const { data, status } = await requestJson('POST', '/acceptance/payment_keys', {
    auth_token: token,
    amount_cents: amountCents,
    expiration: 3600,
    order_id: orderId,
    billing_data: {
      apartment: 'NA',
      email: billing.email || 'guest@cairohomes.com',
      floor: 'NA',
      first_name: billing.firstName || 'Guest',
      street: 'NA',
      building: 'NA',
      phone_number: billing.phone || '+200000000000',
      shipping_method: 'NA',
      postal_code: 'NA',
      city: 'Cairo',
      country: 'EG',
      last_name: billing.lastName || 'Cairo Homes',
      state: 'NA',
    },
    currency,
    integration_id: Number(process.env.PAYMOB_INTEGRATION_ID),
  });
  if (status >= 400 || !data?.token) {
    throw new Error(`Paymob payment key failed: ${JSON.stringify(data)}`);
  }
  return data.token;
}

function buildIframeUrl(paymentKey) {
  const iframeId = process.env.PAYMOB_IFRAME_ID;
  return `https://accept.paymob.com/api/acceptance/iframes/${iframeId}?payment_token=${paymentKey}`;
}

async function initializePaymobCheckout({ amountEgp, merchantOrderId, billing }) {
  const amountCents = Math.round(Number(amountEgp) * 100);
  const token = await getAuthToken();
  const order = await createOrder(token, { amountCents, merchantOrderId });
  const paymentKey = await createPaymentKey(token, order.id, { amountCents, billing });
  return {
    amountCents,
    paymobOrderId: String(order.id),
    paymentKey,
    checkoutUrl: buildIframeUrl(paymentKey),
  };
}


function verifyPaymobHmac(obj, receivedHmac) {
  const secret = process.env.PAYMOB_HMAC_SECRET;
  if (!secret || !receivedHmac) return false;

  const order = [
    'amount_cents',
    'created_at',
    'currency',
    'error_occured',
    'has_parent_transaction',
    'id',
    'integration_id',
    'is_3d_secure',
    'is_auth',
    'is_capture',
    'is_refunded',
    'is_standalone_payment',
    'is_voided',
    'order',
    'owner',
    'pending',
    'source_data_pan',
    'source_data_sub_type',
    'source_data_type',
    'success',
  ];

  const objAny = obj.obj || obj;
  const concatenated = order
    .map((key) => {
      if (key === 'order') return String(objAny.order?.id ?? objAny.order ?? '');
      if (key.startsWith('source_data_')) {
        const sub = key.replace('source_data_', '');
        return String(objAny.source_data?.[sub] ?? '');
      }
      return String(objAny[key] ?? '');
    })
    .join('');

  const digest = crypto.createHmac('sha512', secret).update(concatenated).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(receivedHmac)));
  } catch {
    return false;
  }
}

module.exports = {
  initializePaymobCheckout,
  verifyPaymobHmac,
  buildIframeUrl,
};
