# Build context is the repo root: docker build -f apps/console/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/console ./apps/console
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @recall/console build

FROM node:22-slim
WORKDIR /app
# RECALL_API_URL and SIMULATOR_URL are read at request time, never baked in (see next.config.mjs).
ENV NODE_ENV=production PORT=3000
COPY --from=build /repo/apps/console/.next/standalone ./
COPY --from=build /repo/apps/console/.next/static ./apps/console/.next/static
EXPOSE 3000
# Next's standalone server binds whatever HOSTNAME says, and App Runner injects its own (the
# container's hostname), which leaves the port unreachable to a health check. Setting it in the
# command wins over anything the platform puts in the environment.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 node apps/console/server.js"]
