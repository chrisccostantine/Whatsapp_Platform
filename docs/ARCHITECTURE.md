# Scalora CRM architecture

Scalora is an npm-workspaces monorepo with independently deployable React and Express applications. `shared` contains transport-safe types and constants; it must never depend on either application.

## Tenant boundary

The access token identifies a user, membership, business, and role. Authentication reloads that membership from PostgreSQL for every protected request, so disabling a member takes effect without waiting for token expiry. Route services derive `businessId` exclusively from `req.auth`; client-supplied tenant identifiers are not trusted. Resource reads include both the resource ID and authenticated `businessId`. Tenant-isolation tests cover this invariant.

Every Phase 1 domain table has a `businessId` column and tenant-focused indexes. Soft-deleted records are excluded by repository filters. Authorization has three layers: valid access token, active membership, and role/resource checks.

## Authentication

Access tokens are short-lived. Opaque refresh tokens live in HttpOnly cookies; only SHA-256 hashes are stored. Every refresh rotates the token. Reuse of a revoked token revokes its full token family. Password changes and resets revoke active refresh tokens.

## Modules

Backend modules own their routes, validation, and services. Phase 1 modules are auth, business onboarding, customers, tags/notes, follow-ups, pipeline, and dashboard. Phase 2 adds conversations and real-time delivery. Phase 3 adds encrypted WhatsApp accounts, the official Cloud provider, signed webhooks, durable processing, templates, session rules, and media proxying. Phase 4 adds consent-safe campaigns, unsubscribe automation, queued delivery, retries, and delivery reporting. Phase 5 adds the product/service catalog, orders, quotations, invoices, payments, atomic conversions, and PDFs. Phase 6 adds date-scoped reports, CSV export, notifications and preferences, subscription entitlements, usage limits, audit access, and operational health sweeps.

## Subscription and operations

New businesses receive a 14-day full-feature trial. After the trial, Starter, Growth, and Pro capabilities and quotas are enforced by backend middleware, never by UI visibility alone. Customer creation is checked atomically against the authenticated tenant's entitlement. A billing-provider interface keeps payment-provider integration separate from authorization.

Notifications include tenant and recipient keys and use deterministic deduplication for scheduled conditions. The worker marks overdue follow-ups and invoices, reports WhatsApp connection problems, and creates opted-in in-app alerts. Notification reads and preferences always include both authenticated `businessId` and `userId`.

Reports are derived only from authenticated tenant data, support bounded date ranges, and escape spreadsheet values in UTF-8 CSV exports. Audit-log access is restricted to owners and admins.

## Real-time inbox

Socket.IO authenticates with the same short-lived access token and reloads the active membership before joining `business:{businessId}`. Conversation rooms are joined only after a tenant-scoped database lookup; sales agents must also be assigned. REST remains the source of truth and Socket.IO events invalidate client caches.

Public messages and internal notes use separate tables and endpoints. This prevents an employee-only note from ever entering a provider send path. Outgoing messages use tenant-scoped idempotency keys. The mock provider implements the same interface that the official Cloud API provider will implement in Phase 3.

## WhatsApp Cloud processing

Credential fields use AES-256-GCM authenticated encryption. Decryption occurs only inside the provider factory and plaintext credentials are never returned, logged, or emitted. Graph requests are restricted to the configured version of `graph.facebook.com`.

Webhook POST requests require Meta's `X-Hub-Signature-256`. The raw body is verified before parsing. A SHA-256 event key and database unique constraint prevent duplicate processing. The API returns HTTP 200 after persistence, while BullMQ workers process messages and statuses with exponential retries. Incoming messages reopen the 24-hour session window and automatically match or create E.164 customers.

Template creation submits validated Marketing or Utility text components to the connected WABA through the versioned Graph API. Placeholder numbering and approval examples are validated server-side, the returned Meta ID and pending status are stored tenant-side, and only owners/admins may submit. Synchronization remains the source of truth for later approval, rejection, pause, or disable status changes. Connecting credentials also subscribes the Meta app to the tenant's WABA so the configured webhook receives message and status events.

## Campaign and consent safety

Campaign audiences always include the authenticated `businessId`, an active marketing opt-in, no opt-out timestamp, and a normalized phone number. Launch freezes a de-duplicated recipient set, but every BullMQ delivery job checks consent and template approval again immediately before sending. Opt-outs create immutable `ConsentRecord` rows and atomically skip pending recipients. Inbound `STOP`, `UNSUBSCRIBE`, `CANCEL`, `إلغاء`, and `الغاء` messages use the same opt-out service.

Campaign jobs use exponential retries and a global worker limiter. Final failures are stored per recipient. Meta delivery webhooks and subsequent inbound replies update tenant-scoped campaign counters without trusting client data.

## Commerce and financial integrity

Catalog items, documents, line items, and payments are tenant-scoped. Product references and assignees are verified against the authenticated workspace. Prices and taxes are snapshotted onto line items so historical documents do not change when the catalog changes. A shared decimal calculation service rejects invalid discounts and avoids binary floating-point totals.

Document numbers use atomic PostgreSQL-backed per-business sequences. Quotation conversions run in one transaction and unique source-quotation constraints prevent duplicate conversion. Payment recording locks its calculation inside a transaction, rejects overpayments, and derives partial/paid balances server-side. PDFs are generated in memory and returned only after a tenant-scoped document lookup.

## Railway topology

- Web service: static React build served by nginx.
- API service: stateless Express container; runs `prisma migrate deploy` before start.
- PostgreSQL service: Railway PostgreSQL, connected through `DATABASE_URL`.
- Redis service: Railway Redis, connected through `REDIS_URL` (required from Phase 2 onward).
- Persistent files: production storage uses an S3-compatible provider; local disk is development-only.

Railway terminates TLS and provides `PORT`. The API listens on `0.0.0.0`, trusts one proxy hop, has health checks, and returns no production stack traces.
