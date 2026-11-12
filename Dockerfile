ARG NODE_VERSION=26
ARG PNPM_VERSION=12.11.1

FROM ghcr.io/pnpm/pnpm:${PNPM_VERSION} AS dependencies

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json ./server/package.json
COPY packages/crypto/package.json ./packages/crypto/package.json
COPY packages/http/package.json ./packages/http/package.json
COPY packages/scrydex/package.json ./packages/scrydex/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:${NODE_VERSION}-trixie-slim AS base

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/server/node_modules ./server/node_modules
COPY --from=dependencies /app/packages/http/node_modules ./packages/http/node_modules
COPY packages/crypto/package.json ./packages/crypto/package.json
COPY packages/http/package.json ./packages/http/package.json
COPY packages/crypto/src ./packages/crypto/src
COPY packages/http/src ./packages/http/src
COPY --from=dependencies /app/packages/scrydex/node_modules ./packages/scrydex/node_modules
COPY packages/scrydex/package.json ./packages/scrydex/package.json
COPY packages/scrydex/src ./packages/scrydex/src
COPY package.json ./
COPY server/src ./server/src
COPY scripts/check-server-image-health.ts ./server/scripts/check-health.ts

USER node
EXPOSE 8080

FROM base AS migration
COPY server/drizzle ./server/drizzle
COPY server/scripts/migrate.ts server/scripts/check-deployment.ts server/scripts/check-migrations.ts server/scripts/deployment-database.ts ./server/scripts/
WORKDIR /app/server
CMD ["node", "--help"]

FROM base AS runtime
CMD ["node", "server/src/index.ts"]
