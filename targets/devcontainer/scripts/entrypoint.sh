#!/usr/bin/env sh
set -eu

TARGET_ENV=/opt/new-devkit/targets/devcontainer.env
if [ -f "$TARGET_ENV" ]; then
	set -a
	. "$TARGET_ENV"
	set +a
fi

if [ -S /var/run/docker.sock ]; then
	SOCKET_GID=$(stat -c %g /var/run/docker.sock 2>/dev/null || echo '')
	DOCKER_GID=$(getent group docker 2>/dev/null | cut -d: -f3 || echo '')
	if [ -n "$SOCKET_GID" ] && [ -n "$DOCKER_GID" ] && [ "$SOCKET_GID" != "$DOCKER_GID" ]; then
		sudo chgrp docker /var/run/docker.sock 2>/dev/null || true
	fi
fi

BACKEND_PORT=${NEW_DEVKIT_BACKEND_PORT:-7748}
LOG_DIR=${HOME}/.new-devkit
LOG_FILE=${LOG_DIR}/backend.log

mkdir -p "$LOG_DIR"

if ! curl -fsS --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
	nohup devkit-backend --host 0.0.0.0 --port "$BACKEND_PORT" --no-open >> "$LOG_FILE" 2>&1 < /dev/null &
	BACKEND_PID=$!
	for _ in $(seq 1 40); do
		if curl -fsS --max-time 1 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
			break
		fi
		sleep 0.5
	done
	echo "[new-devkit] Backend starting on :${BACKEND_PORT} (PID: ${BACKEND_PID})"
fi

exec "$@"
