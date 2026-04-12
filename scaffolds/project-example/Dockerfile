FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY contracts/package.json contracts/
COPY dapp/package.json dapp/
COPY ui-shared/package.json ui-shared/
RUN pnpm install --frozen-lockfile

# Copy source
COPY contracts/ contracts/
COPY dapp/ dapp/
COPY ui-shared/ ui-shared/
COPY vite/ vite/
COPY scripts/ scripts/
COPY deployments/ deployments/

# Optional address overrides for non-local image builds.
# - CONTRACT_ADDRESSES_FILE points to a JSON map file inside build context
# - otherwise EXAMPLE_COUNTER_ADDRESS + EXAMPLE_COUNTER_CHAIN_ID are used
ARG CONTRACT_ADDRESSES_FILE
ARG EXAMPLE_COUNTER_ADDRESS
ARG EXAMPLE_COUNTER_CHAIN_ID=2030

# Ensure frontend address artifact exists in the production image build flow.
RUN node ./scripts/write-contract-artifact.mjs

# Generate contract artifacts and build the dapp
RUN pnpm run codegen
RUN pnpm --filter dapp build
RUN pnpm --filter dapp build:server

# Create standalone deployment (real node_modules, no symlinks)
RUN pnpm --filter dapp deploy --legacy deploy

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/deploy/node_modules ./node_modules
COPY --from=build /app/deploy/package.json ./
COPY --from=build /app/dapp/dist ./dist
COPY --from=build /app/dapp/dist-server ./dist-server

EXPOSE 3030
CMD ["node", "dist-server/server.js"]
