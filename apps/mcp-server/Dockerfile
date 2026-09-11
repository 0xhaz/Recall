# Build context is the repo root: docker build -f apps/mcp-server/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/mcp-server ./apps/mcp-server
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @recall/mcp-server... build
RUN pnpm --filter @recall/mcp-server deploy --prod /out

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/mcp-server/dist ./dist
COPY --from=build /repo/apps/mcp-server/migrations ./migrations
EXPOSE 3100
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
