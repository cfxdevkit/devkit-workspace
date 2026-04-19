# syntax=docker/dockerfile:1.7
#
# Base image for devkit infrastructure.
# Expects pre-built artifacts in packages/devkit-base/artifacts/generated/:
#   - devkit-backend.tgz   (backend npm tarball, built by prepare-devkit-artifacts.mjs)
#   - devkit.vsix           (VS Code extension, built by prepare-devkit-artifacts.mjs)
#   - devkit-mcp.tgz        (MCP server tarball, built by prepare-devkit-artifacts.mjs)
#   - devkit-dex-ui.tgz     (DEX UI npm tarball, built by prepare-devkit-artifacts.mjs)
#   - config/               (target-agnostic config files)

# ── Stage 1: VSIX extraction ─────────────────────────────────────────────
# Unpack the extension once here so the final image never carries the VSIX.
FROM node:22-bookworm-slim AS vsix-extractor

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/*

COPY packages/devkit-base/artifacts/generated/devkit.vsix /tmp/devkit.vsix
RUN mkdir -p /tmp/vsix-extracted \
 && unzip -q /tmp/devkit.vsix -d /tmp/vsix-extracted

# ── Stage 2: Runtime image ────────────────────────────────────────────────
FROM node:22-bookworm-slim AS base-tools

ARG DEBIAN_FRONTEND=noninteractive

# Runtime deps only — no unzip, no jq, no legacy docker-compose v1:
#   - docker-ce-cli:  Docker CLI only (DooD socket passthrough, ~20 MB vs ~70 MB for docker.io)
#   - gh:             GitHub CLI from GitHub's official apt repository (not in the default Debian slim sources)
#   - libsqlite3-0:   SQLite runtime used by devkit-backend
#   - tini:           PID 1 signal reaping
#   - curl, ca-certificates, git, sudo: standard runtime tooling
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git sudo tini libsqlite3-0 jq \
     openssh-client \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh docker-ce-cli docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/* \
 && echo 'node ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/node \
 && chmod 0440 /etc/sudoers.d/node

WORKDIR /opt/devkit

# ── pnpm (rarely changes — cached aggressively) ───────────────────────────
RUN npm install -g pnpm@10.33.0 \
 && npm cache clean --force

# ── Static config (rarely changes) ───────────────────────────────────────
COPY packages/devkit-base/artifacts/config /home/node/.config/devkit/

# ── Scripts ───────────────────────────────────────────────────────────────
COPY scripts/prefetch-dex-feeds.mjs /opt/devkit/scripts/prefetch-dex-feeds.mjs

# ── Install npm packages globally from tarballs, then wipe npm cache ──────
COPY packages/devkit-base/artifacts/generated/devkit-backend.tgz /tmp/artifacts/devkit-backend.tgz
COPY packages/devkit-base/artifacts/generated/devkit-dex-ui.tgz  /tmp/artifacts/devkit-dex-ui.tgz
COPY packages/devkit-base/artifacts/generated/devkit-mcp.tgz     /tmp/artifacts/devkit-mcp.tgz

RUN npm install -g /tmp/artifacts/devkit-backend.tgz \
 && npm install -g /tmp/artifacts/devkit-dex-ui.tgz \
 && npm install -g /tmp/artifacts/devkit-mcp.tgz \
 && npm cache clean --force \
 && rm -rf /tmp/artifacts

# ── Copy pre-extracted extension from builder stage ───────────────────────
# The VSIX is never written to the final image — only the extracted contents.
COPY --from=vsix-extractor /tmp/vsix-extracted/extension /opt/devkit/extensions/vsix-extension

RUN chown -R node:node /opt/devkit/extensions /home/node/.config

ENV DEVKIT_HOME=/opt/devkit

USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
