# Partner inventory API

Private feed of **published rental** units for an external website. Details only (no availability calendar).

**Access model:** read-only pull + optional outbound webhooks. Partners cannot create, edit, or delete units in Cairo Homes, and webhook payloads never include fields beyond this public inventory shape (no owner, commission, ops, or scrape internals).

## Setup (Cairo Homes)

1. Set a long random secret in the server environment:

```bash
PARTNER_INVENTORY_API_KEY=replace-with-a-long-random-secret
```

2. Restart the API. Without this env var, partner routes return `503`.

3. Give the partner the **base URL** of your API (e.g. `https://api.example.com`) and the key. They must call from **their backend** — never put the key in browser JavaScript.

4. (Optional) Enable outbound inventory webhooks so Cairo Homes pushes changes to the partner:

```bash
PARTNER_WEBHOOK_URL=https://partner.example.com/webhooks/cairo-homes-inventory
PARTNER_WEBHOOK_SECRET=replace-with-a-long-random-secret
```

## Auth

Send the key on every **pull** request:

```http
Authorization: Bearer YOUR_KEY
```

or:

```http
X-Api-Key: YOUR_KEY
```

Wrong or missing key → `401 Unauthorized`.

## Endpoints

### List inventory

`GET /api/partners/v1/inventory`

Query params:

| Param    | Default | Notes              |
|----------|---------|--------------------|
| `limit`  | 50      | Max 200            |
| `offset` | 0       | Pagination offset  |

Only returns units with `status=published` and `listing_type=rent`.

```bash
curl -sS \
  -H "Authorization: Bearer YOUR_KEY" \
  "https://YOUR_API_HOST/api/partners/v1/inventory?limit=50&offset=0"
```

Response shape:

```json
{
  "items": [ /* public unit objects */ ],
  "total": 123,
  "limit": 50,
  "offset": 0
}
```

### Unit detail

`GET /api/partners/v1/inventory/:idOrSlug`

`:idOrSlug` is the unit UUID or slug. Draft/sale units are not returned (`404`).

```bash
curl -sS \
  -H "Authorization: Bearer YOUR_KEY" \
  "https://YOUR_API_HOST/api/partners/v1/inventory/some-unit-slug"
```

## Outbound webhooks (Cairo Homes → partner)

Cairo Homes can POST signed events to your `PARTNER_WEBHOOK_URL` when a published rental unit enters, changes on, or leaves the inventory feed.

This is **outbound only**. Receiving a webhook does **not** grant write access to Cairo Homes.

### Events

| Event | Meaning |
|-------|---------|
| `inventory.unit.upserted` | Unit is on the partner feed (create / update / publish) |
| `inventory.unit.removed` | Unit left the feed (unpublish / delete / no longer published rent) |

### Headers

```http
Content-Type: application/json
X-CairoHomes-Event: inventory.unit.upserted
X-CairoHomes-Delivery-Id: 11111111-2222-3333-4444-555555555555
X-CairoHomes-Signature: sha256=<hmac-sha256-hex-of-raw-body>
```

Verify `X-CairoHomes-Signature` with `PARTNER_WEBHOOK_SECRET` over the **raw request body**. Reject unsigned or invalid requests. Use `X-CairoHomes-Delivery-Id` for idempotency.

### Example payload (`upserted`)

```json
{
  "id": "11111111-2222-3333-4444-555555555555",
  "event": "inventory.unit.upserted",
  "created_at": "2026-09-21T10:00:00.000Z",
  "data": {
    "unit_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "slug": "zamalek-apt-12",
    "unit": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "slug": "zamalek-apt-12",
      "title": "Nile-view apartment · Zamalek",
      "listing_type": "rent",
      "status": "published",
      "compound": "Zamalek",
      "area": "Zamalek",
      "beds": 2,
      "baths": 2,
      "guests": 4,
      "cover_url": "https://…/cover.jpg",
      "photo_urls": ["https://…/1.jpg"],
      "from_price": 9200,
      "price_currency": "EGP"
    }
  }
}
```

`data.unit` uses the **same public inventory fields** as `GET /inventory/:id`. On `inventory.unit.removed`, `data.unit` is `null` — remove that listing from your cache (or treat a later detail `404` as gone).

### Partner handler sketch (Node)

```js
const crypto = require('crypto');

function verifyPartnerSignature(rawBody, signatureHeader, secret) {
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const got = String(signatureHeader || '');
  return (
    got.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  );
}

// Express: app.post('/webhooks/cairo-homes-inventory', express.raw({ type: 'application/json' }), ...)
```

Cairo Homes retries failed deliveries a few times on network/5xx errors. Prefer acknowledging with `2xx` quickly, then process asynchronously.

## Unit fields

Payload matches the guest-site public unit shape (owner, commission, ops, and scrape fields are stripped). Useful fields include:

- Identity: `id`, `slug`, `title`, `listing_type`, `status`
- Location: `compound`, `area`, `city`, `lat`, `lng`
- Specs: `property_type`, `beds`, `baths`, `guests`, `size_m2`
- Media: `cover_url`, `photo_urls`
- Copy: `short_description`, `the_property`, `guest_access`, `neighborhood`, `getting_around` (detail)
- Amenities: `amenities`, `facilities`
- Price: `price_fallback`, `from_price`, `price_currency`, `price_as_of` (when a today rate exists)
- Reviews: `average_rating`, `review_count`

List responses may include fewer photos (`photo_urls` capped) than detail.

## Limits

Partner routes are rate-limited (about 120 requests per 15 minutes per IP), on top of the global API limit.

## Revoking access

- Rotate or remove `PARTNER_INVENTORY_API_KEY` and restart — pull access stops.
- Clear or rotate `PARTNER_WEBHOOK_URL` / `PARTNER_WEBHOOK_SECRET` — outbound pushes stop.
