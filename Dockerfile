FROM node:22-bookworm-slim AS node-base
# The patched Docker tags have empty OCI indexes. Use the official glibc tarball.
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && case "$TARGETARCH" in \
         arm64) arch=arm64; sha=6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b ;; \
         amd64) arch=x64; sha=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce ;; \
         *) exit 1 ;; \
       esac \
    && curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-$arch.tar.xz" \
    && echo "$sha  /tmp/node.tar.xz" | sha256sum -c - \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && test "$(node --version)" = v22.23.4

FROM node-base AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG PUBLIC_SUPABASE_URL
ARG PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV PUBLIC_SUPABASE_URL=$PUBLIC_SUPABASE_URL
ENV PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLIC_SUPABASE_PUBLISHABLE_KEY

RUN npm run build && npm run build:arena

FROM node-base AS arena-server
WORKDIR /app
COPY --from=build /app/build-server/arena-server.cjs ./arena-server.cjs
COPY --from=build /app/node_modules/ws ./node_modules/ws
USER node
EXPOSE 8788
HEALTHCHECK --interval=15s --timeout=3s --start-period=3s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "arena-server.cjs"]

FROM nginx:1.29-alpine

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget --quiet --spider http://127.0.0.1/ || exit 1
