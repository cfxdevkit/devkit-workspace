#!/usr/bin/env sh
set -eu

TARGET_ENV=/opt/new-devkit/targets/code-server.env
if [ -f "$TARGET_ENV" ]; then
	set -a
	. "$TARGET_ENV"
	set +a
fi

BACKEND_PORT=${NEW_DEVKIT_BACKEND_PORT:-7748}
LOG_DIR=${HOME}/.new-devkit
LOG_FILE=${LOG_DIR}/backend.log

mkdir -p "$LOG_DIR"

if ! curl -fsS --max-time 2 "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
	nohup devkit-backend --host 0.0.0.0 --port "$BACKEND_PORT" --no-open >> "$LOG_FILE" 2>&1 < /dev/null &
fi

exec "$@"
