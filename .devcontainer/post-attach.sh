#!/usr/bin/env bash
set -euo pipefail

# Runs after VS Code has attached to the container.
#
# Codespaces sometimes loads the first browser session before the remote
# extension host fully picks up a pre-seeded custom extension. Re-installing the
# same VSIX after attach causes VS Code to show its built-in reload prompt.
#
# Gate this by extension version so users see the prompt once per version.

if ! command -v code >/dev/null 2>&1; then
    exit 0
fi

if [ ! -f /opt/devkit/devkit.vsix ]; then
    exit 0
fi

EXT_DIR="$(ls -d "$HOME"/.vscode-server/extensions/local.cfxdevkit-workspace-ext-* 2>/dev/null | head -1 || true)"
if [ -z "$EXT_DIR" ]; then
    EXT_DIR="$(ls -d "$HOME"/.vscode-remote/extensions/local.cfxdevkit-workspace-ext-* 2>/dev/null | head -1 || true)"
fi

EXT_NAME="${EXT_DIR##*/}"
if [ -z "$EXT_NAME" ]; then
    EXT_NAME="local.cfxdevkit-workspace-ext"
fi

MARKER_DIR="$HOME/.conflux-devkit"
MARKER_FILE="$MARKER_DIR/reload-notified-${EXT_NAME}"
mkdir -p "$MARKER_DIR"

if [ -f "$MARKER_FILE" ]; then
    exit 0
fi

if code --install-extension /opt/devkit/devkit.vsix --force >/dev/null 2>&1; then
    touch "$MARKER_FILE"
    echo "[devkit] Requested VS Code reload prompt for ${EXT_NAME}"
fi