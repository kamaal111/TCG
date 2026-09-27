ARG NODE_VERSION=26
ARG PNPM_VERSION=12.5.1

FROM ghcr.io/pnpm/pnpm:${PNPM_VERSION} AS dependencies

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:${NODE_VERSION}-trixie-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY server/src ./server/src

USER node
EXPOSE 8080

CMD ["node", "server/src/index.ts"]
