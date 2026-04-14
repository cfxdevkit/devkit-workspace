#!/usr/bin/env bash
set -euo pipefail

if [ -S /var/run/docker.sock ]; then
    SOCKET_GID="$(stat -c %g /var/run/docker.sock 2>/dev/null || echo '')"
    DOCKER_GID="$(getent group docker 2>/dev/null | cut -d: -f3 || echo '')"
    if [ -n "$SOCKET_GID" ] && [ -n "$DOCKER_GID" ] && [ "$SOCKET_GID" != "$DOCKER_GID" ]; then
        sudo chgrp docker /var/run/docker.sock 2>/dev/null || true
        echo "[devkit] Docker socket group set to docker (GID: ${DOCKER_GID})"
    fi
    echo "[devkit] Docker socket available (GID: ${SOCKET_GID:-?})"
fi

BACKEND_PORT="${CFXDEVKIT_PORT:-7748}"
LOG_DIR="${HOME}/.conflux-devkit"
LOG_FILE="${LOG_DIR}/backend.log"

mkdir -p "$LOG_DIR"

if ! curl -fsS --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    if ! command -v devkit-backend >/dev/null 2>&1; then
        echo "[devkit] ERROR: devkit-backend binary not found in PATH"
        exit 1
    fi

    nohup devkit-backend --no-open --host 0.0.0.0 --port "$BACKEND_PORT" \
        >> "$LOG_FILE" 2>&1 < /dev/null &
    BACKEND_PID=$!
    disown "$BACKEND_PID"
    echo "[devkit] Backend starting on :${BACKEND_PORT} (PID: $BACKEND_PID, log: $LOG_FILE)"

    BACKEND_HEALTHY=false
    for _ in $(seq 1 40); do
        if curl -fsS --max-time 1 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
            echo "[devkit] Backend healthy"
            BACKEND_HEALTHY=true
            break
        fi
        sleep 0.5
    done

    if [ "$BACKEND_HEALTHY" != true ]; then
        echo "[devkit] WARNING: backend did not become healthy within 20s - check ${LOG_FILE}"
    fi
else
    echo "[devkit] Backend already healthy on :${BACKEND_PORT}"
fi

exec "$@"