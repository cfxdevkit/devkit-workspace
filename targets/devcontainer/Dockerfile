# syntax=docker/dockerfile:1.7

ARG BASE_IMAGE=ghcr.io/cfxdevkit/new-devkit-base:dev
FROM ${BASE_IMAGE} AS devcontainer-target

USER root

COPY targets/devcontainer/config/target.env /opt/new-devkit/targets/devcontainer.env
COPY targets/devcontainer/scripts/entrypoint.sh /usr/local/bin/new-devkit-devcontainer-entrypoint.sh
RUN chmod +x /usr/local/bin/new-devkit-devcontainer-entrypoint.sh \
 && mkdir -p /home/node/.vscode-server/extensions /home/node/.vscode-remote/extensions /tmp/new-devkit-vsix \
 && unzip -q /opt/new-devkit/extensions/devkit.vsix -d /tmp/new-devkit-vsix \
 && cp -r /tmp/new-devkit-vsix/extension /home/node/.vscode-server/extensions/local.new-devkit-workspace-ext-0.0.0 \
 && cp -r /tmp/new-devkit-vsix/extension /home/node/.vscode-remote/extensions/local.new-devkit-workspace-ext-0.0.0 \
 && chown -R node:node /home/node/.vscode-server /home/node/.vscode-remote \
 && rm -rf /tmp/new-devkit-vsix

USER node

ENTRYPOINT ["/usr/local/bin/new-devkit-devcontainer-entrypoint.sh"]
CMD ["sleep", "infinity"]
