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
```

The container applies checked-in Prisma migrations before starting. The Railway health path is `/api/v1/health`. Database and Redis diagnostics are `/api/v1/health/database` and `/api/v1/health/redis`.

### Web

Create a second service with `client/Dockerfile`. Set build argument `VITE_API_URL=https://<api-domain>/api/v1`. Its health path is `/health`.

After the first API deployment, run the seed command only if you want demo data:

```sh
npm run db:seed --workspace @scalora/server
```

Never seed a live customer database. Railway volumes are not used for uploads; configure S3-compatible object storage before enabling production uploads.

