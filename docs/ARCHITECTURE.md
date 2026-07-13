# Scalora CRM architecture

Scalora is an npm-workspaces monorepo with independently deployable React and Express applications. `shared` contains transport-safe types and constants; it must never depend on either application.

## Tenant boundary

The access token identifies a user, membership, business, and role. Authentication reloads that membership from PostgreSQL for every protected request, so disabling a member takes effect without waiting for token expiry. Route services derive `businessId` exclusively from `req.auth`; client-supplied tenant identifiers are not trusted. Resource reads include both the resource ID and authenticated `businessId`. Tenant-isolation tests cover this invariant.

Every Phase 1 domain table has a `businessId` column and tenant-focused indexes. Soft-deleted records are excluded by repository filters. Authorization has three layers: valid access token, active membership, and role/resource checks.

## Authentication

Access tokens are short-lived. Opaque refresh tokens live in HttpOnly cookies; only SHA-256 hashes are stored. Every refresh rotates the token. Reuse of a revoked token revokes its full token family. Password changes and resets revoke active refresh tokens.

## Modules

Backend modules own their routes, validation, services, and future repositories. The Phase 1 modules are auth, business onboarding, customers, tags/notes, follow-ups, pipeline, and dashboard. Later phases add inbox/providers, WhatsApp Cloud API, campaigns/queues, commerce/PDFs, and reporting/subscriptions.

## Railway topology

- Web service: static React build served by nginx.
- API service: stateless Express container; runs `prisma migrate deploy` before start.
- PostgreSQL service: Railway PostgreSQL, connected through `DATABASE_URL`.
- Redis service: Railway Redis, connected through `REDIS_URL` (required from Phase 2 onward).
- Persistent files: production storage uses an S3-compatible provider; local disk is development-only.

Railway terminates TLS and provides `PORT`. The API listens on `0.0.0.0`, trusts one proxy hop, has health checks, and returns no production stack traces.

