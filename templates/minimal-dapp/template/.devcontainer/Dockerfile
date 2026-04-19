ARG DEVKIT_DEVCONTAINER_IMAGE=ghcr.io/cfxdevkit/devkit-devcontainer:dev
FROM ${DEVKIT_DEVCONTAINER_IMAGE}

USER root
RUN mkdir -p /home/node/.local/share/pnpm && chown node:node /home/node/.local/share/pnpm
USER node
