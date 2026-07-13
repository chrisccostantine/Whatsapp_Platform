# Scalora CRM architecture

Scalora is an npm-workspaces monorepo with independently deployable React and Express applications. `shared` contains transport-safe types and constants; it must never depend on either application.

## Tenant boundary

The access token identifies a user, membership, business, and role. Authentication reloads that membership from PostgreSQL for every protected request, so disabling a member takes effect without waiting for token expiry. Route services derive `businessId` exclusively from `req.auth`; client-supplied tenant identifiers are not trusted. Resource reads include both the resource ID and authenticated `businessId`. Tenant-isolation tests cover this invariant.

Every Phase 1 domain table has a `businessId` column and tenant-focused indexes. Soft-deleted records are excluded by repository filters. Authorization has three layers: valid access token, active membership, and role/resource checks.

## Authentication

Access tokens are short-lived. Opaque refresh tokens live in HttpOnly cookies; only SHA-256 hashes are stored. Every refresh rotates the token. Reuse of a revoked token revokes its full token family. Password changes and resets revoke active refresh tokens.

## Modules

Backend modules own their routes, validation, services, and future repositories. Phase 1 modules are auth, business onboarding, customers, tags/notes, follow-ups, pipeline, and dashboard. Phase 2 adds conversations and real-time delivery. Phase 3 adds encrypted WhatsApp accounts, the official Cloud provider, signed webhooks, durable processing, templates, session rules, and media proxying. Phase 4 adds consent-safe campaigns, unsubscribe automation, queued delivery, retries, and delivery reporting. Later phases add commerce/PDFs and reporting/subscriptions.

## Real-time inbox

Socket.IO authenticates with the same short-lived access token and reloads the active membership before joining `business:{businessId}`. Conversation rooms are joined only after a tenant-scoped database lookup; sales agents must also be assigned. REST remains the source of truth and Socket.IO events invalidate client caches.

Public messages and internal notes use separate tables and endpoints. This prevents an employee-only note from ever entering a provider send path. Outgoing messages use tenant-scoped idempotency keys. The mock provider implements the same interface that the official Cloud API provider will implement in Phase 3.

## WhatsApp Cloud processing

Credential fields use AES-256-GCM authenticated encryption. Decryption occurs only inside the provider factory and plaintext credentials are never returned, logged, or emitted. Graph requests are restricted to the configured version of `graph.facebook.com`.

Webhook POST requests require Meta's `X-Hub-Signature-256`. The raw body is verified before parsing. A SHA-256 event key and database unique constraint prevent duplicate processing. The API returns HTTP 200 after persistence, while BullMQ workers process messages and statuses with exponential retries. Incoming messages reopen the 24-hour session window and automatically match or create E.164 customers.

## Campaign and consent safety

Campaign audiences always include the authenticated `businessId`, an active marketing opt-in, no opt-out timestamp, and a normalized phone number. Launch freezes a de-duplicated recipient set, but every BullMQ delivery job checks consent and template approval again immediately before sending. Opt-outs create immutable `ConsentRecord` rows and atomically skip pending recipients. Inbound `STOP`, `UNSUBSCRIBE`, `CANCEL`, `إلغاء`, and `الغاء` messages use the same opt-out service.

Campaign jobs use exponential retries and a global worker limiter. Final failures are stored per recipient. Meta delivery webhooks and subsequent inbound replies update tenant-scoped campaign counters without trusting client data.

## Railway topology

- Web service: static React build served by nginx.
- API service: stateless Express container; runs `prisma migrate deploy` before start.
- PostgreSQL service: Railway PostgreSQL, connected through `DATABASE_URL`.
- Redis service: Railway Redis, connected through `REDIS_URL` (required from Phase 2 onward).
- Persistent files: production storage uses an S3-compatible provider; local disk is development-only.

Railway terminates TLS and provides `PORT`. The API listens on `0.0.0.0`, trusts one proxy hop, has health checks, and returns no production stack traces.
