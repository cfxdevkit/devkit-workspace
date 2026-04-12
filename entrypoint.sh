#!/usr/bin/env bash
# entrypoint.sh — runs as the node user (UID 1000).
# Docker socket access is granted via the launcher wrapper's --group-add handling.
# UID mapping is handled by --userns=keep-id (podman) or natively (docker).

set -euo pipefail

DEFAULT_WORKSPACE="/opt/devkit/project-example"
WORKSPACE="${WORKSPACE:-$DEFAULT_WORKSPACE}"
BACKEND_PORT="${CFXDEVKIT_PORT:-7748}"

drop_to_node() {
    if [ "$(id -u)" -eq 0 ]; then
        export HOME=/home/node
        export USER=node
        export LOGNAME=node
        exec sudo -E -H -u node "$@"
    fi
    exec "$@"
}

start_devkit_backend() {
    local port="$BACKEND_PORT"
    local host="${CFXDEVKIT_HOST:-0.0.0.0}"
    local backend_cli="${CFXDEVKIT_LOCAL_BACKEND_CLI:-/opt/devkit/devkit-backend/dist/cli.js}"
    local log_dir="/home/node/.conflux-devkit"
    local log_file="$log_dir/backend.log"

    if curl -fsS --max-time 2 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
        echo "[devkit] Backend already healthy on :$port"
        return 0
    fi

    mkdir -p "$log_dir"
    chown -R node:node "$log_dir" 2>/dev/null || true

    if [ -f "$backend_cli" ]; then
        echo "[devkit] Starting vendored backend: node $backend_cli --no-open --host $host --port $port"
        sudo -E -H -u node bash -lc \
            "nohup node '$backend_cli' --no-open --host '$host' --port '$port' >> '$log_file' 2>&1 < /dev/null &"
    else
        echo "[devkit] WARNING: vendored backend CLI not found at $backend_cli"
        echo "[devkit] Falling back to global conflux-devkit binary"
        sudo -E -H -u node bash -lc \
            "nohup conflux-devkit --no-open --host '$host' --port '$port' >> '$log_file' 2>&1 < /dev/null &"
    fi

    for _ in $(seq 1 40); do
        if curl -fsS --max-time 2 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
            echo "[devkit] Backend healthy on :$port"
            return 0
        fi
        sleep 0.5
    done

    echo "[devkit] ERROR: backend failed to become healthy on :$port"
    echo "[devkit] Check logs: $log_file"
    return 1
}

# ── Export explicit runtime contract for OpenCode and devkit-mcp ─────────────
export CFXDEVKIT_AGENT_WORKSPACE="$WORKSPACE"
export CFXDEVKIT_PROJECT_ROOT="$WORKSPACE"
export CFXDEVKIT_BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
export CFXDEVKIT_COMPOSE_FILE="docker-compose.yml"
export CFXDEVKIT_RUNTIME_MODE="workspace-container"

# ── Seed project-local agent contract for custom workspaces ───────────────────
# The baked-in project-example workspace already contains these files.
# For user-mounted workspaces, copy the default contract on first use.
if [ "$WORKSPACE" != "$DEFAULT_WORKSPACE" ] && [ ! -f "$WORKSPACE/opencode.json" ]; then
    mkdir -p "$WORKSPACE"
    cp "$DEFAULT_WORKSPACE/opencode.json" "$WORKSPACE/opencode.json" 2>/dev/null || true
    [ -f "$WORKSPACE/opencode.json" ] && \
        echo "[devkit] Created opencode.json → run 'opencode auth login' to configure AI"
fi

if [ "$WORKSPACE" != "$DEFAULT_WORKSPACE" ] && [ ! -f "$WORKSPACE/AGENTS.md" ]; then
    mkdir -p "$WORKSPACE"
    cp "$DEFAULT_WORKSPACE/AGENTS.md" "$WORKSPACE/AGENTS.md" 2>/dev/null || true
fi

if [ "$WORKSPACE" != "$DEFAULT_WORKSPACE" ] && [ ! -d "$WORKSPACE/.opencode" ]; then
    mkdir -p "$WORKSPACE"
    cp -R "$DEFAULT_WORKSPACE/.opencode" "$WORKSPACE/.opencode" 2>/dev/null || true
fi

# ── Enforce baked-in configs (override stale content in devkit-home volume) ───
# The devkit-home volume persists /home/node across container rebuilds.
# Without explicit copy-on-boot, old config.yaml/settings.json from a previous
# image version remain in the volume and override the new image layers.
mkdir -p /home/node/.config/code-server /home/node/.local/share/code-server/User
cp /opt/devkit/config/code-server.yaml /home/node/.config/code-server/config.yaml 2>/dev/null || true
cp /opt/devkit/config/settings.json /home/node/.local/share/code-server/User/settings.json 2>/dev/null || true

# ── Verify docker socket ─────────────────────────────────────────────────────
if [ -S /var/run/docker.sock ]; then
    echo "[devkit] Docker socket available — DooD enabled"
    if [ "$(id -u)" -eq 0 ]; then
        SOCKET_GID="$(stat -c %g /var/run/docker.sock 2>/dev/null || echo 0)"
        if [ -n "$SOCKET_GID" ]; then
            groupmod -o -g "$SOCKET_GID" docker 2>/dev/null || true
            usermod -aG docker node 2>/dev/null || true
        fi
        chgrp docker /var/run/docker.sock 2>/dev/null || true
        chmod g+rw /var/run/docker.sock 2>/dev/null || true
    fi
else
    echo "[devkit] WARNING: no Docker socket mounted"
fi

if ! start_devkit_backend; then
    echo "[devkit] WARNING: continuing without healthy backend"
fi

echo "[devkit] Starting code-server — workspace: $WORKSPACE"
drop_to_node code-server --bind-addr 0.0.0.0:8080 "$WORKSPACE"
