# Build context: labwatch/ (the pnpm workspace root)
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /repo

FROM base AS build
# Manifests first: the dependency layer is rebuilt only when they change, not on every code edit
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/infra/package.json packages/infra/
COPY services/collector/package.json services/collector/
COPY services/gateway/package.json services/gateway/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @labwatch/gateway...
COPY packages/shared packages/shared
COPY packages/infra packages/infra
COPY services/gateway services/gateway
RUN pnpm --filter @labwatch/gateway... build
# A self-contained folder with only production dependencies (workspace packages copied in)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @labwatch/gateway deploy --prod /out

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
