ARG DEVKIT_DEVCONTAINER_IMAGE=ghcr.io/cfxdevkit/devkit-devcontainer:dev
FROM ${DEVKIT_DEVCONTAINER_IMAGE}

# Pre-create the pnpm store dir under the node user so first `pnpm install`
# inside the Codespace doesn't need sudo to create it.
USER root
RUN mkdir -p /home/node/.local/share/pnpm && \
    chown -R node:node /home/node/.local
USER node
