# Build context is the repo root: docker build -f apps/simulator/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/simulator ./apps/simulator
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @recall/simulator... build
RUN pnpm --filter @recall/simulator deploy --prod /out

FROM node:22-slim
WORKDIR /app
# There is no Ollama on AWS: the deployed simulator answers through Bedrock.
ENV NODE_ENV=production SIM_HOST=0.0.0.0 SIM_LLM_PROVIDER=bedrock
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/simulator/dist ./dist
COPY --from=build /repo/apps/simulator/public ./public
COPY --from=build /repo/apps/simulator/replays ./replays
EXPOSE 3200
CMD ["node", "dist/server.js"]
