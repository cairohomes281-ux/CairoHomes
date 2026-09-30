/**
 * Thin HTTP helper for OTA Connectivity endpoints.
 * base_url + api_key (Bearer) or username/password Basic auth from connection.credentials.
 */
async function otaFetch(connection, path, { method = 'GET', body = null, query = null } = {}) {
  const creds = connection?.credentials || {};
  const base = String(creds.base_url || creds.api_base_url || '').replace(/\/$/, '');
  if (!base) {
    throw new Error('Connection credentials require base_url (Connectivity API host)');
  }
  const url = new URL(base + (path.startsWith('/') ? path : `/${path}`));
  if (query && typeof query === 'object') {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'CairoHomes-ChannelManager/2.0',
  };
  if (creds.api_key) {
    headers.Authorization = `Bearer ${creds.api_key}`;
  } else if (creds.client_id && creds.client_secret) {
    const token = Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  } else if (creds.username && creds.password) {
    const token = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
    headers.Authorization = `Basic ${token}`;
  } else {
    throw new Error('Connection credentials require api_key or client_id/client_secret or username/password');
  }
  if (creds.hotel_id) headers['X-Hotel-Id'] = String(creds.hotel_id);
  if (creds.property_id) headers['X-Property-Id'] = String(creds.property_id);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Number(creds.timeout_ms) || 20000);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const msg = json?.error || json?.message || text.slice(0, 200) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function connectionConfigured(connection) {
  const c = connection?.credentials || {};
  const base = c.base_url || c.api_base_url;
  const auth = c.api_key || (c.client_id && c.client_secret) || (c.username && c.password);
  return Boolean(base && auth);
}

module.exports = { otaFetch, connectionConfigured };
