#!/usr/bin/env sh
set -eu

# setup-dex-ui.sh — Idempotent DEX UI dependency installer
#
# Installs production dependencies for the DEX UI server (server.mjs).
# Called from the container entrypoint before the backend starts.
# Safe to re-run: skips if node_modules/.setup-done marker exists.
#
# The DEX UI source + pre-built dist/ are baked into the image at
# /opt/devkit/apps/dex-ui. Only runtime deps (viem, express, etc.)
# need to be installed — the Vite build is already done.

DEX_UI_DIR="${DEX_UI_DIR:-/opt/devkit/apps/dex-ui}"
MARKER="${DEX_UI_DIR}/node_modules/.setup-done"
LOG_PREFIX="[dex-ui-setup]"

if [ ! -d "$DEX_UI_DIR" ] || [ ! -f "${DEX_UI_DIR}/package.json" ]; then
	echo "${LOG_PREFIX} No dex-ui source found at ${DEX_UI_DIR} — skipping."
	exit 0
fi

if [ -f "$MARKER" ]; then
	echo "${LOG_PREFIX} Dependencies already installed (marker: ${MARKER})."
	exit 0
fi

echo "${LOG_PREFIX} Installing DEX UI dependencies in ${DEX_UI_DIR}..."
echo "${LOG_PREFIX} This runs once per container and takes ~15-30 seconds."

cd "$DEX_UI_DIR"

# Clean stale symlinks that cause EEXIST on re-runs (file:./dex-contracts dep)
if [ -L "${DEX_UI_DIR}/node_modules/@cfxdevkit/dex-contracts" ]; then
	rm -f "${DEX_UI_DIR}/node_modules/@cfxdevkit/dex-contracts"
	echo "${LOG_PREFIX} Cleaned stale dex-contracts symlink."
fi

# npm install with retries for flaky networks
ATTEMPTS=0
MAX_ATTEMPTS=3
while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
	ATTEMPTS=$((ATTEMPTS + 1))
	echo "${LOG_PREFIX} npm install attempt ${ATTEMPTS}/${MAX_ATTEMPTS}..."
	if npm install --omit=dev --no-audit --no-fund 2>&1; then
		echo "${LOG_PREFIX} Dependencies installed successfully."
		date -u > "$MARKER"
		exit 0
	fi
	echo "${LOG_PREFIX} Attempt ${ATTEMPTS} failed."
	if [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; then
		echo "${LOG_PREFIX} Retrying in 5 seconds..."
		sleep 5
	fi
done

echo "${LOG_PREFIX} WARNING: npm install failed after ${MAX_ATTEMPTS} attempts."
echo "${LOG_PREFIX} DEX UI may not work. You can retry manually:"
echo "${LOG_PREFIX}   cd ${DEX_UI_DIR} && npm install --omit=dev"
exit 0
