FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm install
COPY shared shared
COPY server server
RUN npm run build --workspace @scalora/shared && npm run build --workspace @scalora/server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/shared/dist shared/dist
USER node
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy --schema server/prisma/schema.prisma && node server/dist/src/index.js"]
