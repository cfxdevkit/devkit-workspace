FROM ghcr.io/cfxdevkit/devkit-workspace-web:edge

ENTRYPOINT ["/opt/devkit/.devcontainer/entrypoint.sh"]
CMD ["sleep", "infinity"]

COPY --chown=node:node .devcontainer/entrypoint.sh /opt/devkit/.devcontainer/entrypoint.sh
RUN chmod +x /opt/devkit/.devcontainer/entrypoint.sh

RUN set -e \
 && EXT_SRC=$(ls -d /home/node/.local/share/code-server/extensions/local.cfxdevkit-workspace-ext-* 2>/dev/null | head -1) \
 && if [ -z "$EXT_SRC" ]; then \
      echo "ERROR: devkit extension not found in code-server extensions dir"; \
      exit 1; \
    fi \
 && EXT_NAME=$(basename "$EXT_SRC") \
 && mkdir -p /home/node/.vscode-server/extensions /home/node/.vscode-remote/extensions \
 && cp -r "$EXT_SRC" "/home/node/.vscode-server/extensions/${EXT_NAME}" \
 && cp -r "$EXT_SRC" "/home/node/.vscode-remote/extensions/${EXT_NAME}" \
 && chown -R node:node /home/node/.vscode-server /home/node/.vscode-remote \
 && echo "[devkit] Pre-installed extension: ${EXT_NAME}"