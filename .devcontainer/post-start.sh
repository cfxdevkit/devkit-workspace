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

BACKEND_PORT="${CFXDEVKIT_PORT:-7748}"
BACKEND_CLI="/opt/devkit/devkit-backend/dist/cli.js"
LOG_DIR="${HOME}/.conflux-devkit"
LOG_FILE="${LOG_DIR}/backend.log"

if curl -fsS --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    echo "[devkit] Backend already healthy on :${BACKEND_PORT}"
    exit 0
fi

mkdir -p "$LOG_DIR"

if [ ! -f "$BACKEND_CLI" ]; then
    echo "[devkit] WARNING: backend CLI not found at $BACKEND_CLI — skipping"
    exit 0
fi

nohup node "$BACKEND_CLI" --no-open --host 0.0.0.0 --port "$BACKEND_PORT" \
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
