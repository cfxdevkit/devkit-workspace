# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE=ghcr.io/cfxdevkit/new-devkit-base:dev
ARG CODE_SERVER_VERSION=4.95.3
FROM ${BASE_IMAGE} AS code-server-target

ARG CODE_SERVER_VERSION

USER root

RUN curl -fsSL https://code-server.dev/install.sh | sh -s -- --method=standalone --version ${CODE_SERVER_VERSION}

COPY targets/code-server/config/target.env /opt/new-devkit/targets/code-server.env
COPY targets/code-server/files/.code-server/config.yaml /home/node/.config/code-server/config.yaml
COPY targets/code-server/scripts/entrypoint.sh /usr/local/bin/new-devkit-code-server-entrypoint.sh
RUN chmod +x /usr/local/bin/new-devkit-code-server-entrypoint.sh \
 && code-server --extensions-dir /home/node/.local/share/code-server/extensions --install-extension /opt/new-devkit/extensions/devkit.vsix \
 && chown -R node:node /home/node/.config

USER node

ENTRYPOINT ["/usr/local/bin/new-devkit-code-server-entrypoint.sh"]
CMD ["code-server", "/workspace"]
