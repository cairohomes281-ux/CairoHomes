# Cairo Homes — Client / Server

```
Cairo Homes/
├── Client/                 # Single Vite SPA (guest + admin + sales)
└── Server/                 # API + database migrations
    ├── src/                # Express API
    └── supabase/migrations/
```

| App | Path | Port | Role |
|-----|------|------|------|
| **Server** | [`Server/`](Server/) | `5000` | Express + Postgres (Supabase) + Cloudinary + Paymob + Socket.io |
| **Client** | [`Client/`](Client/) | `5173` | Guest site, `/admin/*` PMS portal, `/sales/*` |

## Quick start

1. Copy [`.env.example`](.env.example) → `Server/.env` and fill `DATABASE_URL`, Cloudinary, Paymob, `JWT_SECRET`.
2. Migrations live in [`Server/supabase/migrations/`](Server/supabase/migrations/) and apply automatically on Server boot.
3. Install & run:

```bash
npm run install:all
npm run dev:server     # API — http://localhost:5000
npm run dev:client     # SPA — http://localhost:5173
```

- Guest site: http://localhost:5173
- PMS admin: http://localhost:5173/sign-in (staff username → opens `/admin`)

Default staff seed: set `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` to create the initial admin on first boot only (existing passwords are never overwritten).

### Local demo (no Supabase)

A throwaway Postgres runs from `node_modules` (data kept in `%LOCALAPPDATA%/CairoHomes/devdb`).

1. In `Server/.env`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/cairohomes`, plus `ADMIN_PASSWORD`. Set `PORT` if 5000 is taken.
2. Run each in its own terminal:

```bash
npm run dev:db          # Postgres on :5433
npm run dev:server      # applies migrations, creates the admin
npm run seed:demo       # once — Cairo units, reservations, staff, owners, guests (seed:demo:reset rebuilds)
npm run dev:client      # set API_PROXY_TARGET=http://localhost:<PORT> if the API is not on 5000
```

Every seeded login uses the password `Demo@2026` (see the list printed by `seed:demo`). Switching to a real database later is just a new `DATABASE_URL`.

## Architecture

- **Database:** Supabase Postgres — schema SQL under `Server/supabase/migrations/`.
- **Media:** Cloudinary.
- **Payments:** Paymob (`/api/payments/paymob-webhook`).
- **Auth:** Guests → `/api/auth/*`; staff → `/api/staff/auth/*` (JWT). Admin UI under `Client/src/admin` maps calls to `/api/pms/*`.
- **Admin:** Integrated into the Client at `/admin/*` — no separate admin package.

## Brand & guest site

- **Palette:** blush `#e9cfc2`, rose `#fee8e2`, pine `#2f5d58` (+ clay `#b5725a` accent). Tailwind tokens use the `ch-*` prefix (`bg-ch-pine`, `text-ch-clay`, …) — see [`Client/tailwind.config.js`](Client/tailwind.config.js).
- **Type:** Fraunces (display), Marcellus (wordmark), Manrope (body), Reem Kufi + IBM Plex Sans Arabic (Arabic).
- **Logo:** vector mark in [`Client/src/components/brand/Logo.jsx`](Client/src/components/brand/Logo.jsx); original artwork in `Client/public/brand/`.
- **Contact details:** placeholders — set the `VITE_*` values from [`Client/.env.example`](Client/.env.example).
- **Copy:** English/Arabic dictionaries in `Client/src/i18n/en.json` and `ar.json`.
- **Neighbourhoods & photos:** managed in the PMS (**Destinations** page); the seed uses Unsplash photos until you upload your own. `Client/src/data/compounds.js` is only the offline fallback.

See [`WORKSPACE_MAP.md`](WORKSPACE_MAP.md) for the full map.
