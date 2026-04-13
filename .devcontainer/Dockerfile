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
