#!/usr/bin/env sh
# detect-docker-socket.sh — runs as initializeCommand (on the HOST) before
# the devcontainer is created.
#
# Goal: ensure .devcontainer/.docker.sock is a valid symlink pointing to the
# active container-runtime socket, regardless of whether the host uses Docker
# or rootless/rootful Podman.
#
# The devcontainer.json mounts field references this symlink via
#   source=${localWorkspaceFolder}/.devcontainer/.docker.sock
# so the correct socket ends up at /var/run/docker.sock inside the container
# on any host runtime.
#
# Detection order:
#   1. $DOCKER_HOST (unix:// stripped) — explicit user override, always wins
#   2. /var/run/docker.sock          — Docker Desktop / Docker Engine / Podman compat layer
#   3. $XDG_RUNTIME_DIR/podman/podman.sock — rootless Podman (most common on Fedora/Arch/Ubuntu)
#   4. /run/user/<uid>/podman/podman.sock  — rootless Podman, explicit UID path
#   5. /run/podman/podman.sock        — rootful Podman
#   6. Exit 1 (container runtime not found)

set -eu

LINK_TARGET=".devcontainer/.docker.sock"

detect_socket() {
    # 1. Explicit DOCKER_HOST override (strip unix:// prefix if present)
    if [ -n "${DOCKER_HOST:-}" ]; then
        candidate=$(echo "$DOCKER_HOST" | sed 's|^unix://||')
        if [ -S "$candidate" ]; then
            echo "$candidate"
            return 0
        fi
    fi

    # 2. Standard docker socket (Docker Engine, Docker Desktop, podman-docker compat layer)
    if [ -S /var/run/docker.sock ]; then
        echo "/var/run/docker.sock"
        return 0
    fi

    # 3. Rootless Podman — XDG_RUNTIME_DIR
    XDG_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    if [ -S "${XDG_DIR}/podman/podman.sock" ]; then
        echo "${XDG_DIR}/podman/podman.sock"
        return 0
    fi

    # 4. Rootless Podman — explicit UID path (fallback if XDG_RUNTIME_DIR not set)
    uid_sock="/run/user/$(id -u)/podman/podman.sock"
    if [ -S "$uid_sock" ]; then
        echo "$uid_sock"
        return 0
    fi

    # 5. Rootful Podman
    if [ -S /run/podman/podman.sock ]; then
        echo "/run/podman/podman.sock"
        return 0
    fi

    return 1
}

SOCKET=$(detect_socket) || {
    echo "[devkit] WARNING: No container runtime socket found."
    echo "         Docker-outside-of-Docker (DooD) will not be available."
    echo "         If using Podman, start the socket service:"
    echo "           systemctl --user enable --now podman.socket"
    # Remove stale symlink so the container mount doesn't fail with a broken link.
    rm -f "$LINK_TARGET"
    exit 0
}

# Create / update the symlink.
ln -sf "$SOCKET" "$LINK_TARGET"

# Detect runtime name for the log message.
RUNTIME="docker"
if echo "$SOCKET" | grep -qi podman; then
    RUNTIME="podman"
fi

echo "[devkit] Container runtime detected: ${RUNTIME} (${SOCKET})"
echo "[devkit] Socket symlink: ${LINK_TARGET} -> ${SOCKET}"
