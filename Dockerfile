## syntax=docker/dockerfile:1.7

# CFX DevKit Web — layered multi-stage image
#
# Stages:
#   builder  — compiles TypeScript, packs @cfxdevkit/mcp tarball, packages .vsix
#   fetch-code-server — downloads the pinned code-server .deb once per version
#   fetch-opencode — downloads the pinned opencode archive once per version
#   base     — slim OS with system tools, GitHub CLI, Docker CLI, code-server
#   devkit   — base + vendored devkit backend runtime + @cfxdevkit/mcp
#   opencode — devkit + opencode CLI + config + skills
#   runtime  — opencode + VS Code extension + workspace + entrypoint
#
# The devkit-mcp binary is installed globally via npm, no absolute path or bundle needed.
# opencode.json uses: "command": ["devkit-mcp"]

ARG CODE_SERVER_VERSION=4.115.0
ARG OPENCODE_VERSION=1.3.13

# ══════════════════════════════════════════════════════════════════════════════
# Stage 0 — fetch-code-server
# Downloads the pinned code-server .deb independently from the main build.
# Re-runs only when CODE_SERVER_VERSION or this stage changes.
# ══════════════════════════════════════════════════════════════════════════════
FROM debian:bookworm-slim AS fetch-code-server

ARG CODE_SERVER_VERSION

RUN --mount=type=cache,id=apt-fetch-code-server-cache,target=/var/cache/apt,sharing=locked \
     --mount=type=cache,id=apt-fetch-code-server-lists,target=/var/lib/apt/lists,sharing=locked \
     apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl \
 && mkdir -p /artifacts \
 && curl --proto '=https' --tlsv1.2 --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors -fsSL \
       "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_amd64.deb" \
       -o /artifacts/code-server.deb

# ══════════════════════════════════════════════════════════════════════════════
# Stage 0b — fetch-opencode
# Downloads the pinned opencode archive independently from the main build.
# Re-runs only when OPENCODE_VERSION or this stage changes.
# ══════════════════════════════════════════════════════════════════════════════
FROM debian:bookworm-slim AS fetch-opencode

ARG OPENCODE_VERSION

RUN --mount=type=cache,id=apt-fetch-opencode-cache,target=/var/cache/apt,sharing=locked \
     --mount=type=cache,id=apt-fetch-opencode-lists,target=/var/lib/apt/lists,sharing=locked \
     apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl \
 && mkdir -p /artifacts \
 && curl --proto '=https' --tlsv1.2 --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors -fsSL \
       "https://github.com/sst/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64.tar.gz" \
       -o /artifacts/opencode.tar.gz

# ══════════════════════════════════════════════════════════════════════════════
# Stage 1 — builder
# Compiles all packages and packs @cfxdevkit/mcp as a distributable tarball.
# The 500 MB+ node_modules tree never reaches the final image.
# ══════════════════════════════════════════════════════════════════════════════
FROM node:22-bookworm AS builder

RUN --mount=type=cache,id=npm-builder-cache,target=/root/.npm,sharing=locked \
     npm install -g pnpm \
 && pnpm config set store-dir /pnpm/store

WORKDIR /build

# Copy workspace manifests first — this layer is cached until package.json changes
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json               ./packages/shared/
COPY packages/ui-shared/package.json            ./packages/ui-shared/
COPY packages/contracts/package.json             ./packages/contracts/
COPY packages/contracts/scripts/                 ./packages/contracts/scripts/
COPY packages/mcp-server/package.json           ./packages/mcp-server/
COPY packages/devkit-backend/package.json       ./packages/devkit-backend/
COPY packages/vscode-extension/package.json     ./packages/vscode-extension/
COPY packages/workspace-cli/package.json        ./packages/workspace-cli/
COPY dex-ui/package.json                        ./dex-ui/
COPY packages/ui-shared/package.json            ./project-example/ui-shared/
COPY scaffolds/project-example/ui-shared/package.json   ./scaffolds/project-example/ui-shared/
COPY scaffolds/project-example/dapp/package.json        ./scaffolds/project-example/dapp/
COPY scaffolds/project-example/dapp/package.json        ./project-example/dapp/
COPY scaffolds/project-example/contracts/package.json   ./scaffolds/project-example/contracts/
COPY scaffolds/project-example/contracts/package.json   ./project-example/contracts/
RUN --mount=type=cache,id=pnpm-builder-store,target=/pnpm/store,sharing=locked \
     pnpm install --frozen-lockfile 2>/dev/null || pnpm install --no-frozen-lockfile

# Compile all packages
# Root tsconfig files must be present before tsc runs — all per-package
# tsconfigs extend profiles via relative paths (../../tsconfig.profile.*.json).
COPY tsconfig.base.json tsconfig.profile.node-cjs.json tsconfig.profile.node-esm.json \
     tsconfig.profile.browser-lib.json tsconfig.profile.vscode-extension.json ./
COPY packages/ ./packages/
COPY scaffolds/ ./scaffolds/
COPY scripts/ ./scripts/
COPY dex-ui/ ./dex-ui/
RUN node ./scripts/assemble-project-example.mjs ./project-example --no-clean \
 && mkdir -p dist \
 && pnpm --filter @cfxdevkit/dex-contracts    build \
 && pnpm --filter @cfxdevkit/shared      build \
 && pnpm --filter @cfxdevkit/devkit-backend build \
 && pnpm --filter @cfxdevkit/mcp         build \
 && pnpm --filter cfxdevkit-workspace-ext compile \
 && pnpm --filter cfxdevkit-workspace-ext package \
 && pnpm --filter conflux-workspace      build \
 && pnpm --filter cfxdevkit-example-dapp build

RUN --mount=type=cache,id=pnpm-project-example-store,target=/pnpm/store,sharing=locked \
      cd /build/project-example \
 && pnpm install --frozen-lockfile 2>/dev/null || pnpm install --no-frozen-lockfile \
 && pnpm run build

# Prepare runtime-only backend manifest for image install.
# npm may still evaluate peer ranges from devDependencies during --omit=dev,
# so we persist a sanitized package.json with only production fields.
RUN mkdir -p /tmp/devkit-backend-runtime \
 && node -e " \
               const fs = require('fs'); \
               const pkg = JSON.parse(fs.readFileSync('/build/packages/devkit-backend/package.json', 'utf8')); \
               const runtimePkg = { \
                    name: pkg.name, \
                    version: pkg.version, \
                    description: pkg.description, \
                    private: pkg.private, \
                    main: pkg.main, \
                    bin: pkg.bin, \
                    license: pkg.license, \
                    type: pkg.type, \
                    dependencies: pkg.dependencies ?? {} \
               }; \
               if (runtimePkg.dependencies['@cfxdevkit/shared']?.startsWith('workspace:')) { \
                    runtimePkg.dependencies['@cfxdevkit/shared'] = 'file:./shared'; \
               } \
               if (!runtimePkg.type) delete runtimePkg.type; \
               fs.writeFileSync('/tmp/devkit-backend-runtime/package.json', JSON.stringify(runtimePkg, null, 2)); \
          "
RUN mkdir -p /tmp/devkit-backend-runtime/shared/dist \
 && cp -r /build/packages/shared/dist/. /tmp/devkit-backend-runtime/shared/dist/ \
 && cp /build/packages/shared/package.json /tmp/devkit-backend-runtime/shared/package.json

# Prepare DEX UI server runtime deps outside the pnpm workspace.
# server.mjs only needs viem + @cfxdevkit/dex-contracts at runtime.
# pnpm workspace node_modules use symlinks that break when copied to runtime.
# Install viem only via npm; manually copy pre-built dex-contracts dist to avoid
# file: reference resolution failures when node_modules is transplanted to runtime.
RUN mkdir -p /tmp/dex-server \
 && cp /build/dex-ui/server.mjs /tmp/dex-server/ \
 && node -e " \
      const fs = require('fs'); \
      fs.writeFileSync('/tmp/dex-server/package.json', JSON.stringify({ \
        name: 'dex-server', version: '1.0.0', type: 'module', \
        dependencies: { 'viem': '^2.23.0' } \
      }, null, 2)); \
     "
RUN --mount=type=cache,id=npm-dex-server-cache,target=/root/.npm,sharing=locked \
     cd /tmp/dex-server \
 && npm install --omit=dev --fetch-retries 5 --fetch-retry-mintimeout 10000 \
 && mkdir -p node_modules/@cfxdevkit/dex-contracts/dist \
 && cp -r /build/packages/contracts/dist/. node_modules/@cfxdevkit/dex-contracts/dist/ \
 && cp /build/packages/contracts/package.json node_modules/@cfxdevkit/dex-contracts/

# Pack @cfxdevkit/mcp into a self-contained tarball for global install.
# @cfxdevkit/shared is a workspace:* dep — not published to npm.
# IMPORTANT: Copy to an isolated temp directory OUTSIDE the pnpm workspace
# before running npm install. Running npm install inside a pnpm-managed
# node_modules causes transitive deps (abitype, ox, etc.) to be missing
# because npm sees pnpm's symlink/.pnpm layout and skips resolution.
# bundledDependencies: true bundles ALL deps + transitive into the tarball.
RUN mkdir -p /tmp/mcp-pack \
 && cp -r packages/shared             /tmp/mcp-pack/shared \
 && cp -r packages/contracts/dist     /tmp/mcp-pack/dex-contracts-dist \
 && node -e " \
      const fs = require('fs'); \
      const pkg = JSON.parse(fs.readFileSync('packages/contracts/package.json')); \
      pkg.exports = { '.': { 'import': './index.js', 'default': './index.js' } }; \
      delete pkg.scripts; \
      fs.writeFileSync('/tmp/mcp-pack/dex-contracts-dist/package.json', JSON.stringify(pkg, null, 2)); \
    " \
 && cp -r packages/mcp-server/dist    /tmp/mcp-pack/dist \
 && cp    packages/mcp-server/package.json /tmp/mcp-pack/ \
 && cd /tmp/mcp-pack \
 && node -e " \
      const fs = require('fs'); \
      const pkg = JSON.parse(fs.readFileSync('package.json')); \
      pkg.dependencies['@cfxdevkit/shared'] = 'file:./shared'; \
      pkg.dependencies['@cfxdevkit/dex-contracts'] = 'file:./dex-contracts-dist'; \
      pkg.bundledDependencies = true; \
      fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2)); \
     "
RUN --mount=type=cache,id=npm-mcp-pack-cache,target=/root/.npm,sharing=locked \
     cd /tmp/mcp-pack \
 && npm install --omit=dev --fetch-retries 5 --fetch-retry-mintimeout 10000 \
 && npm pack --pack-destination /tmp/ \
 && mv /tmp/cfxdevkit-mcp-*.tgz /tmp/cfxdevkit-mcp.tgz

# ══════════════════════════════════════════════════════════════════════════════
# Stage 2 — base
# Slim OS: system tools, GitHub CLI, Docker CLI, code-server.
# Shared foundation — rebuilt infrequently (only when APT packages change).
# ══════════════════════════════════════════════════════════════════════════════
FROM node:22-bookworm-slim AS base

ARG DEBIAN_FRONTEND=noninteractive

# All apt packages in ONE layer to minimise image size
RUN --mount=type=cache,id=apt-base-cache,target=/var/cache/apt,sharing=locked \
     --mount=type=cache,id=apt-base-lists,target=/var/lib/apt/lists,sharing=locked \
     apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git \
      procps htop less tree jq nano vim-tiny \
      sudo \
      iputils-ping dnsutils net-tools iproute2 wget \
      openssh-client \
      bash-completion man-db \
 # ── GitHub CLI ──────────────────────────────────────────────────────────────
 && curl --proto '=https' --tlsv1.2 --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 # ── Docker CLI ──────────────────────────────────────────────────────────────
 && install -m 0755 -d /etc/apt/keyrings \
 && curl --proto '=https' --tlsv1.2 --retry 5 --retry-delay 2 --retry-connrefused --retry-all-errors -fsSL https://download.docker.com/linux/debian/gpg \
      -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      gh \
      docker-ce-cli docker-compose-plugin docker-buildx-plugin \
 && rm -rf /var/lib/apt/lists/*

# pnpm — available in all subsequent stages (workspace projects use pnpm workspaces)
RUN --mount=type=cache,id=npm-base-cache,target=/root/.npm,sharing=locked \
    npm install -g pnpm
# Create docker group with GID 999 (Docker CE socket default); add node to it.
# The entrypoint re-aligns the GID at runtime if the host socket differs.
RUN groupadd -g 999 docker 2>/dev/null || true \
 && usermod -aG docker node \
 && echo "node ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/node \
 && chmod 0440 /etc/sudoers.d/node

# code-server — downloaded in an isolated version-pinned fetch stage
COPY --from=fetch-code-server /artifacts/code-server.deb /tmp/code-server.deb
RUN dpkg -i /tmp/code-server.deb \
 && rm /tmp/code-server.deb

# code-server user config
RUN mkdir -p /home/node/.config/code-server
COPY config/code-server.yaml /home/node/.config/code-server/config.yaml
RUN chown -R node:node /home/node/.config

# ══════════════════════════════════════════════════════════════════════════════
# Stage 3 — devkit
# Adds vendored devkit backend runtime and @cfxdevkit/mcp global install.
# After this stage the `devkit-mcp` binary is available at /usr/local/bin/.
# ══════════════════════════════════════════════════════════════════════════════
FROM base AS devkit

# Vendored backend package runtime (no global conflux-devkit dependency).
# The extension launcher resolves /opt/devkit/devkit-backend/dist/cli.js first.
COPY --from=builder /tmp/devkit-backend-runtime/package.json /opt/devkit/devkit-backend/package.json
COPY --from=builder /tmp/devkit-backend-runtime/shared/ /opt/devkit/devkit-backend/shared/
COPY --from=builder /build/packages/devkit-backend/dist/ /opt/devkit/devkit-backend/dist/
RUN --mount=type=cache,id=npm-devkit-backend-cache,target=/root/.npm,sharing=locked \
     cd /opt/devkit/devkit-backend \
 && npm install --omit=dev --no-package-lock --fetch-retries 5 --fetch-retry-mintimeout 10000

# @cfxdevkit/mcp: installs the devkit-mcp global binary
# Install from the packed tarball produced by the builder stage
COPY --from=builder /tmp/cfxdevkit-mcp.tgz /tmp/cfxdevkit-mcp.tgz
RUN npm install -g --offline /tmp/cfxdevkit-mcp.tgz \
 && rm /tmp/cfxdevkit-mcp.tgz

# ══════════════════════════════════════════════════════════════════════════════
# Stage 4 — opencode
# Adds opencode CLI, configuration, and skills.
# ══════════════════════════════════════════════════════════════════════════════
FROM devkit AS opencode

# opencode — downloaded in an isolated version-pinned fetch stage
COPY --from=fetch-opencode /artifacts/opencode.tar.gz /tmp/opencode.tar.gz
RUN tar -xzf /tmp/opencode.tar.gz -C /usr/local/bin/ \
 && rm /tmp/opencode.tar.gz \
 && chmod +x /usr/local/bin/opencode

# opencode config + skills
WORKDIR /opt/devkit
COPY opencode.json .
COPY .opencode/    .opencode/

# Config templates baked in — enforced at every startup by entrypoint.sh
# (overrides stale content in the devkit-home persistent volume)
COPY config/settings.json    config/settings.json
COPY config/code-server.yaml config/code-server.yaml

# ══════════════════════════════════════════════════════════════════════════════
# Stage 5 — runtime
# Adds VS Code extension, pre-seeds user settings, workspace, entrypoint.
# ══════════════════════════════════════════════════════════════════════════════
FROM opencode AS runtime

# Install VS Code extensions from builder artifact
COPY --from=builder /build/dist/devkit.vsix /tmp/devkit.vsix
RUN mkdir -p /home/node/.local/share/code-server/extensions \
              /home/node/.local/share/code-server/User \
 && code-server --extensions-dir /home/node/.local/share/code-server/extensions \
                --install-extension /tmp/devkit.vsix \
 && code-server --extensions-dir /home/node/.local/share/code-server/extensions \
                --install-extension sst-dev.opencode \
 && rm /tmp/devkit.vsix

COPY config/settings.json /home/node/.local/share/code-server/User/settings.json
RUN chown -R node:node /home/node/.local

# Project example workspace (default workspace shipped with the image)
COPY --chown=node:node scaffolds/project-example/ project-example/
# Assemble the built-in workspace from the same shared ui package the template uses.
COPY --chown=node:node packages/ui-shared/ project-example/ui-shared/
# Copy project-example dapp build artifacts from builder (excluded from build context by .dockerignore).
COPY --chown=node:node --from=builder /build/project-example/dapp/dist/        project-example/dapp/dist/
COPY --chown=node:node --from=builder /build/project-example/dapp/dist-server/ project-example/dapp/dist-server/

# Standalone DEX UI — Uniswap V2 swap/LP interface (managed by DEX UI status bar)
# Baked into the image so it can be started without internet access.
# server.mjs runs as a Node process; uses @cfxdevkit/dex-contracts from node_modules.
COPY --chown=node:node --from=builder /build/dex-ui/dist            dex-ui/dist/
COPY --chown=node:node --from=builder /tmp/dex-server/server.mjs    dex-ui/server.mjs
COPY --chown=node:node --from=builder /tmp/dex-server/package.json  dex-ui/package.json
COPY --chown=node:node --from=builder /tmp/dex-server/node_modules  dex-ui/node_modules/

# Default workspace (override at runtime: -e WORKSPACE=/workspace)
ENV WORKSPACE=/opt/devkit/project-example

# Custom project mount point
RUN mkdir -p /workspace && chown node:node /workspace

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 8080
USER root
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
