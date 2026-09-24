# Build context: labwatch/ (the pnpm workspace root)
FROM node:24-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/infra/package.json packages/infra/
COPY services/collector/package.json services/collector/
COPY services/gateway/package.json services/gateway/
COPY apps/web/package.json apps/web/
# Only the web app's own dependencies: the gateway and shared packages are used for types only,
# and type imports are erased by the bundler (type-checking runs in CI, not in the image build)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @labwatch/web
COPY apps/web apps/web
RUN pnpm --filter @labwatch/web build

FROM nginx:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
