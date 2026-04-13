# CFX DevKit — devcontainer image
#
# Uses the pre-built workspace image as a base (all tools, devkit backend,
# opencode, MCP server, VS Code extension, and project-example workspace
# are all baked in).
#
# The only change vs the standalone image is the entrypoint:
#   - Standalone image: entrypoint starts code-server (browser IDE on :8080)
#   - Devcontainer:     entrypoint starts the devkit backend, then execs the
#                       command injected by VS Code remote / Codespaces so the
#                       native VS Code interface can attach normally.

FROM ghcr.io/cfxdevkit/devkit-workspace-web:edge

# Replace the code-server entrypoint with a small wrapper that starts the
# backend service, then hands off to the command provided by the devcontainer
# runtime.
ENTRYPOINT ["/opt/devkit/.devcontainer/entrypoint.sh"]
CMD ["sleep", "infinity"]

# Bake in the devcontainer helper scripts so the entrypoint can reference them
# via absolute image paths regardless of whether the repository folder is mounted.
COPY --chown=node:node entrypoint.sh /opt/devkit/.devcontainer/entrypoint.sh
RUN chmod +x /opt/devkit/.devcontainer/entrypoint.sh

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

