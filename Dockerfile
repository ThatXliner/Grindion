FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG PUBLIC_SUPABASE_URL
ARG PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV PUBLIC_SUPABASE_URL=$PUBLIC_SUPABASE_URL
ENV PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLIC_SUPABASE_PUBLISHABLE_KEY

RUN npm run build && npm run build:arena

FROM node:22-alpine AS matchmaker

WORKDIR /app

COPY deploy/matchmaker.mjs ./matchmaker.mjs

USER node
EXPOSE 8787

HEALTHCHECK --interval=15s --timeout=3s --start-period=3s --retries=3 \
	CMD wget --quiet --spider http://127.0.0.1:8787/health || exit 1

CMD ["node", "matchmaker.mjs"]

FROM node:22-alpine AS arena-server
WORKDIR /app
COPY --from=build /app/build-server/arena-server.cjs ./arena-server.cjs
COPY --from=build /app/node_modules/ws ./node_modules/ws
USER node
EXPOSE 8788
HEALTHCHECK --interval=15s --timeout=3s --start-period=3s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1:8788/health || exit 1
CMD ["node", "arena-server.cjs"]

FROM nginx:1.29-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget --quiet --spider http://127.0.0.1/ || exit 1
