# Deploying Scalora on Railway

## Services

Create one Railway project with PostgreSQL, Redis, API, and Web services connected to this repository.

### API

Set the root directory to the repository root and Dockerfile path to `server/Dockerfile`. Add:

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
META_WEBHOOK_VERIFY_TOKEN=<random-webhook-token>
WHATSAPP_API_VERSION=v23.0
```

The container applies checked-in Prisma migrations before starting. The Railway health path is `/api/v1/health`. Database and Redis diagnostics are `/api/v1/health/database` and `/api/v1/health/redis`.

### Web

Create a second service with `client/Dockerfile`. Set build argument `VITE_API_URL=https://<api-domain>/api/v1`. Its health path is `/health`.

### WhatsApp worker

Create a third service from `server/Dockerfile` with the same API environment variables and override its start command:

```sh
npm run db:migrate --workspace @scalora/server && npm run start:worker --workspace @scalora/server
```

The worker must share the API's PostgreSQL and Redis services. Do not expose a public domain for it. Configure Meta's webhook callback as `https://<api-domain>/api/v1/whatsapp/webhook` and subscribe to the `messages` field.

After the first API deployment, run the seed command only if you want demo data:

```sh
npm run db:seed --workspace @scalora/server
```

Never seed a live customer database. Railway volumes are not used for uploads; configure S3-compatible object storage before enabling production uploads.
