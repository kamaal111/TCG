ARG NODE_VERSION=26
ARG PNPM_VERSION=12.5.1

FROM ghcr.io/pnpm/pnpm:${PNPM_VERSION} AS dependencies

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json ./server/package.json
COPY packages/scrydex/package.json ./packages/scrydex/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:${NODE_VERSION}-trixie-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/server/node_modules ./server/node_modules
COPY --from=dependencies /app/packages/scrydex/node_modules ./packages/scrydex/node_modules
COPY packages/scrydex/package.json ./packages/scrydex/package.json
COPY packages/scrydex/src ./packages/scrydex/src
COPY package.json ./
COPY server/src ./server/src

USER node
EXPOSE 8080

CMD ["node", "server/src/index.ts"]
