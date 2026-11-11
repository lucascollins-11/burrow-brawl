# syntax=docker/dockerfile:1

# Build stage: install the whole workspace from the lockfile and build the server.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Copy manifests first so the dependency layer is cached.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY shared shared
COPY server server
RUN pnpm --filter @burrow-brawl/server build

# Runtime stage: only the compiled server and its manifest.
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY --from=build /repo/server/package.json ./server/package.json
COPY --from=build /repo/server/dist ./server/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
