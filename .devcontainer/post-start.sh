#!/usr/bin/env bash
# .devcontainer/post-start.sh
#
# Runs on every container start (postStartCommand). Idempotent.
# 1. Fixes Docker socket group ownership so docker commands work.
# 2. Starts the devkit backend as a background service.
#
# The devkit VS Code extension does NOT need to be installed here — the
# Dockerfile pre-seeds it into /home/node/.vscode-server/extensions/ so
# VS Code Server picks it up automatically on startup (no reload required).
#
# The backend is launched with setsid+disown so it survives when
# postStartCommand's shell process group is cleaned up by the Codespace runner.
#
# Used only in the devcontainer / Codespace environment where the image
# entrypoint is overridden to `sleep infinity` so VS Code Server can run.

set -euo pipefail


# ── Docker socket GID alignment ───────────────────────────────────────────────
# The image bakes docker group GID=999 and adds the node user to it.
# In GitHub Codespaces and some local Docker setups the mounted socket may have
# a different GID. Realign the docker group to match so docker commands work
# without "permission denied". node has passwordless sudo for this.
if [ -S /var/run/docker.sock ]; then
    SOCKET_GID="$(stat -c %g /var/run/docker.sock 2>/dev/null || echo '')"
    DOCKER_GID="$(getent group docker 2>/dev/null | cut -d: -f3 || echo '')"
    if [ -n "$SOCKET_GID" ] && [ -n "$DOCKER_GID" ] && [ "$SOCKET_GID" != "$DOCKER_GID" ]; then
        # Change the socket's group to match the container's docker group rather than
        # the reverse (groupmod). groupmod only takes effect on new logins; chgrp takes
        # effect immediately so the already-running VS Code Server session can use it.
        sudo chgrp docker /var/run/docker.sock 2>/dev/null || true
        echo "[devkit] Docker socket group set to docker (GID: ${DOCKER_GID})"
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

if ! command -v devkit-backend >/dev/null 2>&1; then
    echo "[devkit] ERROR: devkit-backend binary not found in PATH"
    exit 1
fi

nohup devkit-backend --no-open --host 0.0.0.0 --port "$BACKEND_PORT" \
    >> "$LOG_FILE" 2>&1 < /dev/null &
BACKEND_PID=$!
# Fully detach the background process from this shell's job table so it
# survives when postStartCommand's shell process group is cleaned up.
disown "$BACKEND_PID"

echo "[devkit] Backend starting on :${BACKEND_PORT} (PID: $BACKEND_PID, log: $LOG_FILE)"

# Wait up to 20 seconds for it to become healthy
for _ in $(seq 1 40); do
    if curl -fsS --max-time 1 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
        echo "[devkit] Backend healthy"
        exit 0
    fi
    sleep 0.5
done

echo "[devkit] WARNING: backend did not become healthy within 20s — check $LOG_FILE"
