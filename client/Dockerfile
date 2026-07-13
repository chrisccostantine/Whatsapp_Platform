FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
COPY package*.json ./
COPY client/package.json client/package.json
COPY shared/package.json shared/package.json
RUN npm install
COPY client client
COPY shared shared
RUN npm run build --workspace @scalora/shared && npm run build --workspace @scalora/client
FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
