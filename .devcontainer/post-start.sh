#!/usr/bin/env bash
# .devcontainer/post-start.sh
#
# Starts the devkit backend as a background service.
# Runs on every VS Code attach (idempotent — skips if already healthy).
#
# Used only in the devcontainer / Codespace environment where the image
# entrypoint is overridden to `sleep infinity` so VS Code Server can run.
# In the standalone container the entrypoint handles this directly.

set -euo pipefail

# ── Docker socket GID alignment ───────────────────────────────────────────────
# The image bakes docker group GID=999 and adds the node user to it.
# In GitHub Codespaces and some local Docker setups the mounted socket may have
# a different GID. Realign the docker group to match so docker commands work
# without "permission denied". node has passwordless sudo for this.
if [ -S /var/run/docker.sock ]; then
    SOCKET_GID="$(stat -c %g /var/run/docker.sock 2>/dev/null || echo '')"
    CURRENT_GID="$(getent group docker 2>/dev/null | cut -d: -f3 || echo '')"
    if [ -n "$SOCKET_GID" ] && [ "$SOCKET_GID" != "0" ] && [ "$SOCKET_GID" != "$CURRENT_GID" ]; then
        sudo groupmod -o -g "$SOCKET_GID" docker 2>/dev/null || true
        echo "[devkit] Docker group GID realigned: ${CURRENT_GID} → ${SOCKET_GID}"
    fi
    echo "[devkit] Docker socket available (GID: ${SOCKET_GID:-?})"
fi

BACKEND_PORT="${CFXDEVKIT_PORT:-7748}"
LOG_DIR="${HOME}/.conflux-devkit"
LOG_FILE="${LOG_DIR}/backend.log"

if curl -fsS --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    echo "[devkit] Backend already healthy on :${BACKEND_PORT}"
    exit 0
fi

mkdir -p "$LOG_DIR"

# Resolve backend command — support both image layouts:
#   New (current codebase): devkit-backend global binary in PATH
#   Old (published image):  node /opt/devkit/devkit-backend/dist/cli.js
if command -v devkit-backend >/dev/null 2>&1; then
    BACKEND_CMD="devkit-backend"
elif [ -f /opt/devkit/devkit-backend/dist/cli.js ]; then
    BACKEND_CMD="node /opt/devkit/devkit-backend/dist/cli.js"
    echo "[devkit] Using legacy backend path: /opt/devkit/devkit-backend/dist/cli.js"
else
    echo "[devkit] ERROR: devkit-backend not found (no binary in PATH, no /opt/devkit/devkit-backend/dist/cli.js)"
    exit 1
fi

nohup $BACKEND_CMD --no-open --host 0.0.0.0 --port "$BACKEND_PORT" \
    >> "$LOG_FILE" 2>&1 < /dev/null &

echo "[devkit] Backend starting on :${BACKEND_PORT} (log: $LOG_FILE)"

# Wait up to 20 seconds for it to become healthy
for _ in $(seq 1 40); do
    if curl -fsS --max-time 1 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
        echo "[devkit] Backend healthy"
        exit 0
    fi
    sleep 0.5
done

echo "[devkit] WARNING: backend did not become healthy within 20s — check $LOG_FILE"
