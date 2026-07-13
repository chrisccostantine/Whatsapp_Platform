# Scalora CRM

Scalora CRM is a responsive, multi-tenant SaaS foundation for Lebanese businesses that sell and support customers through WhatsApp. This repository is being delivered in six quality-gated phases. Phases 1–3 establish the CRM, real-time inbox, and official WhatsApp Cloud API integration.

## Repository

```text
client/   React + Vite + TypeScript + Tailwind
server/   Express + TypeScript + Prisma + PostgreSQL
shared/   Shared transport types and constants
docs/     Architecture, OpenAPI, and Railway deployment
```

## Local setup

Prerequisites: Node.js 22+, npm 10+, PostgreSQL 16+, and Redis 7+.

1. Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env`.
2. Start PostgreSQL and Redis (optionally with `docker compose up -d`).
3. Install dependencies with `npm install` when you are ready.
4. Generate Prisma Client and apply migrations:

   ```sh
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

5. Start both applications with `npm run dev`.

API: `http://localhost:4000/api/v1`  
Web: `http://localhost:5173`

## Demo accounts

After running the seed script:

| Role | Email | Password |
|---|---|---|
| Owner | `owner@demo.scalora.app` | `Demo123!` |
| Admin | `admin@demo.scalora.app` | `Demo123!` |
| Sales agent | `agent@demo.scalora.app` | `Demo123!` |

These credentials are for local/demo environments only.

## Verification

```sh
npm run typecheck
npm test
npm run build
```

A separate PostgreSQL database should be supplied for future integration suites. Tenant-isolation tests are mandatory at each phase gate.

## Security model

- Access tokens are short-lived; opaque HttpOnly refresh tokens rotate on every refresh.
- Refresh-token hashes—not raw tokens—are stored in PostgreSQL, with reuse detection and family revocation.
- Every protected request reloads its active business membership from the database.
- Tenant IDs come from verified authentication context, never request payloads.
- Customer queries include `businessId` and soft-deletion filters.
- Zod validation, Helmet, strict CORS, rate limits, request limits, safe errors, and log redaction are enabled.

See [architecture](docs/ARCHITECTURE.md), [Railway deployment](docs/RAILWAY.md), and [OpenAPI](docs/openapi.yaml).

## Delivery phases

- Phase 1: foundation and CRM
- Phase 2: shared inbox, conversations, Socket.IO, mock WhatsApp provider (implemented)
- Phase 3: official WhatsApp Cloud API, webhooks, templates, media (implemented)
- Phase 4: consent-safe campaigns and BullMQ processing
- Phase 5: products, orders, quotations, invoices, payments, PDFs
- Phase 6: full reports, notifications, plan enforcement, audit coverage, final deployment hardening

No unofficial WhatsApp Web automation will be used. Production messaging will use Meta's official Cloud API behind a provider abstraction.

## Local mock WhatsApp

The inbox uses `MOCK_WHATSAPP` until Phase 3 credentials are connected. In development, owners/admins can simulate an inbound message through `POST /api/v1/conversations/mock/incoming` with a tenant-owned `customerId` and `body`. Outgoing mock messages automatically transition from sent to delivered to read and emit Socket.IO events. The simulator is unavailable when `NODE_ENV=production`.

## Official WhatsApp Cloud API

Owners connect an official number under Settings → WhatsApp. The API validates credentials directly with Meta before encrypting them with AES-256-GCM. Signed webhooks are persisted and queued before background processing. Free-form messages require an active 24-hour customer-service window; approved templates are used outside that window. The mock provider cannot send in production.
