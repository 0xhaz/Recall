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
# RDS presents an Amazon-issued certificate that Node does not trust out of the box. With this
# bundle the connection string can say sslmode=verify-full and mean it, rather than falling back
# to an encrypted channel nobody has authenticated.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
ENV NODE_ENV=production HOST=0.0.0.0 NODE_EXTRA_CA_CERTS=/app/rds-ca.pem
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/mcp-server/dist ./dist
COPY --from=build /repo/apps/mcp-server/migrations ./migrations
EXPOSE 3100
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
