# Build context is the repo root: docker build -f apps/console/Dockerfile .
#
# This image carries two processes: the console, and the simulated Alexa+ it drives. They are
# separate services locally (`pnpm console`, `pnpm sim`) and stay separate in the code — the console
# reaches the simulator over HTTP either way. They share a container because App Runner has no
# sidecars and this account is capped at two services per region; the console would otherwise have
# no assistant to talk to.
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/console ./apps/console
COPY apps/simulator ./apps/simulator
RUN pnpm install --frozen-lockfile
# Identifies this build to the browser, so a tab from an older one reloads rather than erroring.
ARG NEXT_DEPLOYMENT_ID=dev
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID
RUN pnpm --filter @recall/console build
RUN pnpm --filter @recall/simulator... build
RUN pnpm --filter @recall/simulator deploy --prod /sim

FROM node:22-slim
WORKDIR /app
# RECALL_API_URL and SIMULATOR_URL are read at request time, never baked in (see next.config.mjs).
ARG NEXT_DEPLOYMENT_ID=dev
# The running server compares against the same id the client bundles were built with.
ENV NODE_ENV=production PORT=3000 NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID \
    SIM_HOST=127.0.0.1 SIM_PORT=3200 SIMULATOR_URL=http://127.0.0.1:3200
COPY --from=build /repo/apps/console/.next/standalone ./
COPY --from=build /repo/apps/console/.next/static ./apps/console/.next/static
COPY --from=build /sim/node_modules /sim/node_modules
COPY --from=build /sim/package.json /sim/package.json
COPY --from=build /repo/apps/simulator/dist /sim/dist
COPY --from=build /repo/apps/simulator/public /sim/public
COPY --from=build /repo/apps/simulator/replays /sim/replays
EXPOSE 3000
# The simulator is the optional half: if it exits, the console still serves every other page and
# says plainly that the assistant is not answering. Next binds whatever HOSTNAME says, and App
# Runner injects the container's own, so it is set here where it wins.
CMD ["sh", "-c", "node /sim/dist/server.js & HOSTNAME=0.0.0.0 node apps/console/server.js"]
