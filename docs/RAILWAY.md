# Deploying Scalora on Railway

## Services

Create one Railway project with PostgreSQL, Redis, API, Web, and Worker services connected to this repository. Keep the Root Directory set to `/` for all three application services because this is a shared npm-workspaces monorepo.

### API

Connect the GitHub repository and set the Config File Path to `/railway.api.json`. Add:

```env
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_ACCESS_SECRET=<at-least-32-random-characters>
JWT_REFRESH_SECRET=<different-at-least-32-random-characters>
ACCESS_TOKEN_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN_DAYS=30
CLIENT_URL=https://<web-domain>
ENCRYPTION_KEY=<at-least-32-random-characters>
META_APP_ID=<meta-app-id>
META_APP_SECRET=<meta-app-secret>
META_EMBEDDED_SIGNUP_CONFIG_ID=<facebook-login-for-business-configuration-id>
META_WEBHOOK_VERIFY_TOKEN=<random-webhook-token>
WHATSAPP_API_VERSION=v23.0
```

For one-click customer onboarding, create a **Facebook Login for Business** configuration using the WhatsApp Embedded Signup variation in the Meta app dashboard, then copy its Configuration ID into `META_EMBEDDED_SIGNUP_CONFIG_ID`. Add the Web service domain to the Meta app's allowed JavaScript SDK domains. Only the API service needs these Meta variables; the app secret and customer access tokens are never exposed in the browser.

The container applies checked-in Prisma migrations before starting. The Railway liveness path is `/api/v1/health`. Database and Redis diagnostics are `/api/v1/health/database` and `/api/v1/health/redis`; `/api/v1/health/ready` checks both dependencies together for production readiness monitoring.

### Web

Connect the same GitHub repository to a second service and set its Config File Path to `/railway.web.json`. Set `VITE_API_URL=https://<api-domain>/api/v1` and `PORT=80`. The config uses `client/Dockerfile` and health path `/health`.

The Web service also publishes crawler-readable legal pages for Meta App Review:

- Privacy Policy: `https://<web-domain>/privacy/`
- Terms of Service: `https://<web-domain>/terms/`
- User Data Deletion: `https://<web-domain>/data-deletion/`

### WhatsApp worker

Connect the same GitHub repository to a third service and set its Config File Path to `/railway.worker.json`. Give it the same backend variables as the API. It starts with:

```sh
npm run start:worker --workspace @scalora/server
```

The API config runs checked-in migrations as a pre-deploy command. The worker must share the API's PostgreSQL and Redis services and should be deployed after the API migration succeeds. It also runs the Phase 6 notification and overdue-invoice/follow-up sweep every minute. Do not expose a public domain for it. Configure Meta's webhook callback as `https://<api-domain>/api/v1/whatsapp/webhook` and subscribe to the `messages` field.

After the first API deployment, run the seed command only if you want demo data:

```sh
npm run db:seed --workspace @scalora/server
```

Never seed a live customer database. Railway volumes are not used for uploads; configure S3-compatible object storage before enabling production uploads.
