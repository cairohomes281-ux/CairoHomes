# WhatsApp Cloud API (Meta) — what Cairo Homes needs from you

Do this in Meta before production sends work. Until keys exist, Cairo Homes skips WhatsApp quietly.

## 1. Business + Developer app
1. Open [Meta Business Manager](https://business.facebook.com) for Cairo Homes.
2. Create a [Meta Developer](https://developers.facebook.com) app (type: **Business**).
3. Add the **WhatsApp** product.

## 2. Phone number
1. WhatsApp → **API Setup** → add a business phone number.
2. Prefer a number not already on personal WhatsApp (or use Meta’s migrate flow).
3. Complete SMS/voice verification.

## 3. Credentials → Railway / `Server/.env`
Copy from API Setup (use a long-lived **System User** token for production):

```
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...   # optional
WHATSAPP_API_VERSION=v21.0
WHATSAPP_TEMPLATE_LANG=en
```

## 4. Approve these 2 templates (names must match env or defaults)

### `booking_accepted` (Utility)
Body example (5 variables, same order Cairo Homes sends):

> Hi {{1}}, your Cairo Homes stay at {{2}} is confirmed. Check-in {{3}}, check-out {{4}}. Ref {{5}}.

Cairo Homes maps: guest name, listing title, check-in, check-out, reference.

### `checkout_feedback` (Utility / Marketing as Meta requires)
Body example (3 variables):

> Hi {{1}}, thanks for staying with Cairo Homes at {{2}}. We’d love your feedback: {{3}}

Cairo Homes maps: guest name, listing title, review URL.

Optional overrides:
```
WHATSAPP_TEMPLATE_BOOKING_ACCEPTED=booking_accepted
WHATSAPP_TEMPLATE_CHECKOUT_FEEDBACK=checkout_feedback
```

Wait until Meta shows **Approved**, then redeploy with env vars set.

## 5. Test
- Meta test numbers only message allowlisted phones until the business is live.
- Accept a website booking with a guest phone → booking WhatsApp.
- After a reservation’s check-out date (Cairo), the morning job sends feedback once.
