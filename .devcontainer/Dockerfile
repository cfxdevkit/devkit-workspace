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

FROM ghcr.io/cfxdevkit/devkit-workspace-web:edge

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
# code-server and VS Code Server share the exact same extension directory layout:
#   <publisher>.<name>-<version>/  (with package.json at the root level)
# The extension is already installed by code-server into the base image at
# /home/node/.local/share/code-server/extensions/. Copy that directory directly
# instead of extracting the VSIX — no `unzip` needed and no dependency on
# /opt/devkit/devkit.vsix being present in the base image.
RUN set -e \
 && EXT_SRC=$(ls -d /home/node/.local/share/code-server/extensions/local.cfxdevkit-workspace-ext-* 2>/dev/null | head -1) \
 && if [ -z "$EXT_SRC" ]; then \
      echo "ERROR: devkit extension not found in code-server extensions dir"; \
      exit 1; \
    fi \
 && EXT_NAME=$(basename "$EXT_SRC") \
 && mkdir -p /home/node/.vscode-server/extensions \
 && cp -r "$EXT_SRC" "/home/node/.vscode-server/extensions/${EXT_NAME}" \
 && chown -R node:node /home/node/.vscode-server \
 && echo "[devkit] Pre-installed extension: ${EXT_NAME}"

