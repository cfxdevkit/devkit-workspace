# CFX DevKit — devcontainer image
#
# Uses the pre-built workspace image as a base (all tools, devkit backend,
# opencode, MCP server, VS Code extension, and project-example workspace
# are all baked in).
#
# The only change vs the standalone image is the entrypoint:
#   - Standalone image: entrypoint starts code-server (browser IDE on :8080)
#   - Devcontainer:     entrypoint is reset so VS Code remote / Codespace can
#                       inject its own VS Code Server, which provides the native
#                       VS Code interface in both the browser (Codespaces) and
#                       local VS Code (Dev Containers extension).
#
# The devkit backend is started on every attach by post-start.sh instead.

FROM ghcr.io/cfxdevkit/devkit-workspace-web:latest

# Reset the entrypoint so the Dev Containers / Codespace infrastructure can
# keep the container alive with its own process and inject VS Code Server.
ENTRYPOINT []
CMD ["sleep", "infinity"]

# Bake in the devcontainer helper scripts so postStartCommand can reference
# them via their absolute image path (/opt/devkit/.devcontainer/post-start.sh)
# regardless of whether the repository folder is mounted.
COPY --chown=node:node post-start.sh /opt/devkit/.devcontainer/post-start.sh
RUN chmod +x /opt/devkit/.devcontainer/post-start.sh

# Pre-install the devkit VS Code extension for native VS Code remote / Codespace.
#
# `code --install-extension` is unavailable in non-interactive lifecycle scripts
# because the VS Code Server CLI wrapper is only injected into the user's shell
# profile, which /bin/sh does not load.
#
# Solution: a VSIX is a ZIP file — extract it directly into the VS Code Server
# extensions directory. VS Code Server picks up any directory under
# ~/.vscode-server/extensions/<publisher>.<name>-<version>/ on connect.
# `jq` is already present in the base image.
RUN apt-get update && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /home/node/.vscode-server/extensions \
 && cp /opt/devkit/devkit.vsix /tmp/devkit.vsix \
 && cd /tmp && unzip -q devkit.vsix -d devkit-vsix \
 && PUBLISHER=$(jq -r '.publisher' devkit-vsix/extension/package.json) \
 && NAME=$(jq -r '.name' devkit-vsix/extension/package.json) \
 && VERSION=$(jq -r '.version' devkit-vsix/extension/package.json) \
 && mv devkit-vsix/extension "/home/node/.vscode-server/extensions/${PUBLISHER}.${NAME}-${VERSION}" \
 && chown -R node:node /home/node/.vscode-server \
 && rm -rf /tmp/devkit-vsix /tmp/devkit.vsix

