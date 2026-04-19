# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE=ghcr.io/cfxdevkit/devkit-base:dev
FROM ${BASE_IMAGE} AS devcontainer-target

USER root

COPY targets/devcontainer/config/target.env /opt/devkit/targets/devcontainer.env
COPY targets/devcontainer/scripts/entrypoint.sh /usr/local/bin/devkit-devcontainer-entrypoint.sh
RUN chmod +x /usr/local/bin/devkit-devcontainer-entrypoint.sh \
 && mkdir -p /home/node/.vscode-server/extensions /home/node/.vscode-remote/extensions \
 && cp -r /opt/devkit/extensions/vsix-extension /home/node/.vscode-server/extensions/local.devkit-workspace-ext-0.0.0 \
 && cp -r /opt/devkit/extensions/vsix-extension /home/node/.vscode-remote/extensions/local.devkit-workspace-ext-0.0.0 \
 && chown -R node:node /home/node/.vscode-server /home/node/.vscode-remote

USER node

ENTRYPOINT ["/usr/local/bin/devkit-devcontainer-entrypoint.sh"]
CMD ["sleep", "infinity"]
