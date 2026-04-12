#!/bin/sh
# MCP server launcher — runs the self-contained bundle (no node_modules needed).
# bundle.js has all dependencies inlined by esbuild; it works from any directory.
# Note: opencode.json already points directly to the bundle with an absolute path;
# this script is kept as a convenience fallback for manual invocation.
exec node /opt/devkit/packages/mcp-server/dist/bundle.js
