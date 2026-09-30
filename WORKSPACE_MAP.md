# Cairo Homes — Workspace Architectural Map

> **Updated:** 2026-09-29 (Cairo Homes rebrand)  
> **Workspace root:** `Cairo Homes/`

---

## Layout

```
Cairo Homes/
├── Client/                      # Single Vite SPA
│   └── src/
│       ├── …                    # Guest + sales
│       └── admin/               # PMS UI modules (routes under /admin/*)
├── Server/                      # Backend + DB
│   ├── src/                     # Express API — :5000
│   └── supabase/migrations/     # Postgres schema
├── package.json
├── .env.example                 # Copy to Server/.env
├── README.md
└── WORKSPACE_MAP.md
```

```mermaid
flowchart TB
  Guest["Client :5173 guest"] -->|REST| API["Server Express :5000"]
  Admin["Client /admin/*"] -->|JWT /api/staff + /api/pms| API
  Sales["Client /sales"] -->|Socket + /api/sales| API
  API --> DB[(Supabase Postgres)]
  API --> Cloudinary
  API --> Paymob
  Migrations["Server/supabase/migrations"] -.-> DB
```

---

## Server

| Item | Path |
|------|------|
| Entry | `Server/src/server.js` |
| App | `Server/src/app.js` |
| DB pool + auto-migrate | `Server/src/config/db.js` → `Server/supabase/migrations/` |
| Paymob | `Server/src/config/paymob.js` |
| Cloudinary | `Server/src/config/cloudinary.js` |
| PMS routes | `Server/src/routes/pms/` |
| Env | `Server/.env` (from root `.env.example`) |

### Migrations

1. `001_guest_schema.sql`
2. `002_pms_ops.sql`
3. `003_links_and_unit_ops_columns.sql`
4. `004_guest_local_auth.sql`

---

## Client

| Surface | Path | URL |
|---------|------|-----|
| Guest website | `Client/src/` | http://localhost:5173 |
| PMS admin | `Client/src/admin/` | http://localhost:5173/admin (login via `/sign-in`) |
| Sales | `Client/src/pages/sales/` | http://localhost:5173/sales |

Admin Axios rewrites `/auth/*` → `/api/staff/auth/*` and other calls → `/api/pms/*`.

### Guest design system

| Piece | Path |
|-------|------|
| Tokens (`ch-*`) | `Client/tailwind.config.js` |
| Utilities (`ch-btn`, `ch-arch`, `ch-reveal`, …) | `Client/src/index.css` |
| Logo / mark | `Client/src/components/brand/Logo.jsx` |
| Home sections | `Client/src/components/home/` (`HomeHero`, `HeroSearch`, `CompoundGrid`, `TrustSection`, `ConciergeSection`, `HostCta`) |
| Inner-page hero | `Client/src/components/layout/PageHero.jsx` |
| Scroll reveal | `Client/src/components/ui/Reveal.jsx` |
| Brand + contacts | `Client/src/theme/brand.js` (overridable via `Client/.env`) |
| PMS role palettes | `Client/src/admin/utils/roleTheme.js` |

---

## Scripts (root `package.json`)

```bash
npm run install:all
npm run dev:server
npm run dev:client
npm start                 # production Server
```
