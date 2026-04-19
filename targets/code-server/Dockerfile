# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE=ghcr.io/cfxdevkit/devkit-base:dev
ARG CODE_SERVER_VERSION=4.95.3
FROM ${BASE_IMAGE} AS code-server-target

ARG CODE_SERVER_VERSION

USER root

RUN curl -fsSL https://code-server.dev/install.sh | sh -s -- --method=standalone --version ${CODE_SERVER_VERSION} \
 && mv /root/.local/lib/code-server-${CODE_SERVER_VERSION} /opt/code-server \
 && ln -sf /opt/code-server/bin/code-server /usr/local/bin/code-server \
 && rm -rf /root/.local

COPY targets/code-server/config/target.env /opt/devkit/targets/code-server.env
COPY targets/code-server/files/.code-server/config.yaml /home/node/.config/code-server/config.yaml
COPY targets/code-server/scripts/entrypoint.sh /usr/local/bin/devkit-code-server-entrypoint.sh
RUN chmod +x /usr/local/bin/devkit-code-server-entrypoint.sh \
 && mkdir -p /home/node/.local/share/code-server/extensions \
 && cp -r /opt/devkit/extensions/vsix-extension /home/node/.local/share/code-server/extensions/local.devkit-workspace-ext-0.0.0 \
 && chown -R node:node /home/node/.config /home/node/.local

USER node

ENTRYPOINT ["/usr/local/bin/devkit-code-server-entrypoint.sh"]
CMD ["code-server", "/workspace"]
