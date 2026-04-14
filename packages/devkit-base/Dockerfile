# syntax=docker/dockerfile:1.7

FROM node:22-bookworm AS artifact-builder

WORKDIR /build

COPY packages/devkit-backend ./packages/devkit-backend
COPY packages/vscode-extension ./packages/vscode-extension

RUN cd /build/packages/devkit-backend \
 && npm pack --pack-destination /tmp \
 && mv /tmp/new-devkit-devkit-backend-*.tgz /tmp/devkit-backend.tgz

RUN cd /build/packages/vscode-extension \
 && mkdir -p /build/dist \
 && npm install --no-package-lock \
 && npm run package

FROM node:22-bookworm-slim AS base-tools

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git sudo tini unzip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/new-devkit

COPY packages/devkit-base/artifacts/manifest.json ./artifacts/manifest.json
COPY packages/devkit-base/artifacts/generated ./artifacts/generated
COPY packages/devkit-base/artifacts/config ./artifacts/config
COPY packages/devkit-base/src ./src
COPY --from=artifact-builder /tmp/devkit-backend.tgz /tmp/devkit-backend.tgz
COPY --from=artifact-builder /build/dist/devkit.vsix /opt/new-devkit/extensions/devkit.vsix

RUN mkdir -p /opt/new-devkit/runtime/mcp \
			 /opt/new-devkit/extensions \
			 /home/node/.config/new-devkit \
 && npm install -g --offline /tmp/devkit-backend.tgz \
 && rm /tmp/devkit-backend.tgz \
 && tar -xzf ./artifacts/generated/devkit-mcp.tgz -C /opt/new-devkit/runtime/mcp \
 && install -m 0755 /opt/new-devkit/runtime/mcp/bin/devkit-mcp /usr/local/bin/devkit-mcp \
 && cp -R ./artifacts/config/. /home/node/.config/new-devkit/ \
 && chown -R node:node /home/node/.config/new-devkit

ENV NEW_DEVKIT_HOME=/opt/new-devkit

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "./src/index.js"]
