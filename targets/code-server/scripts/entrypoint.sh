#!/usr/bin/env sh
set -eu

# Container entrypoint for code-server target.
#
# Starts the devkit backend, then hands off to code-server.

TARGET_ENV=/opt/devkit/targets/code-server.env
if [ -f "$TARGET_ENV" ]; then
	set -a
	. "$TARGET_ENV"
	set +a
fi

# Fix workspace ownership if bind-mounted from a different user
WORKSPACE_DIR="/workspace"
if [ -d "$WORKSPACE_DIR" ] && ! [ -w "$WORKSPACE_DIR" ]; then
	echo "[devkit] Fixing workspace ownership..."
	sudo chown -R node:node "$WORKSPACE_DIR" 2>/dev/null || echo "[devkit] WARNING: Could not fix workspace ownership"
fi

if [ -d "$WORKSPACE_DIR" ]; then
	export CFXDEVKIT_WORKSPACE="$WORKSPACE_DIR"
fi

if [ -S /var/run/docker.sock ]; then
	SOCKET_GID=$(stat -c %g /var/run/docker.sock 2>/dev/null || echo '')
	if [ -n "$SOCKET_GID" ]; then
		# Remap the docker group GID to match the socket so new sessions have group access.
		sudo groupmod -o -g "$SOCKET_GID" docker 2>/dev/null || true
		sudo usermod -aG docker node 2>/dev/null || true
		# Make the socket world-accessible so the current process tree can use it
		# immediately (group membership changes only take effect on new logins).
		sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
		echo "[devkit] Docker socket configured (GID: ${SOCKET_GID})"
	fi
	export DOCKER_HOST=${DOCKER_HOST:-unix:///var/run/docker.sock}
	echo "[devkit] Docker socket available"
fi

BACKEND_PORT=${DEVKIT_BACKEND_PORT:-7748}
LOG_DIR=${HOME}/.devkit
LOG_FILE=${LOG_DIR}/backend.log

mkdir -p "$LOG_DIR"

if ! curl -fsS --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
	if ! command -v devkit-backend >/dev/null 2>&1; then
		echo "[devkit] ERROR: devkit-backend binary not found in PATH"
		exit 1
	fi

	cd "${CFXDEVKIT_WORKSPACE:-/workspace}"
	nohup devkit-backend --host 0.0.0.0 --port "$BACKEND_PORT" --no-open >> "$LOG_FILE" 2>&1 < /dev/null &
	BACKEND_PID=$!
	echo "[devkit] Backend starting on :${BACKEND_PORT} (PID: ${BACKEND_PID}, log: ${LOG_FILE})"

	for _ in $(seq 1 40); do
		if curl -fsS --max-time 1 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
			echo "[devkit] Backend healthy"
			break
		fi
		sleep 0.5
	done
else
	echo "[devkit] Backend already healthy on :${BACKEND_PORT}"
fi

exec "$@"
