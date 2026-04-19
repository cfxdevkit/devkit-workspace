# Conflux DevKit — Minimal Dapp

This workspace runs the Conflux DevKit stack inside a devcontainer.
The `devkit` MCP server is registered in `.vscode/mcp.json`.

## MCP-First Operating Model

**Always prefer MCP tools over shell commands or direct API calls.**
The devkit backend is always-on inside the container (port 7748).

## Cold Start Checklist

1. `conflux_status` — read `Next step` and follow it exactly
2. `conflux_keystore_unlock` — only if keystore is locked
3. `conflux_node_start` — only if node is stopped
4. `conflux_accounts` — verify funded genesis accounts

## Key MCP Tool Groups

| Prefix | Purpose |
|--------|---------|
| `conflux_*` | Node lifecycle, keystore, network, contracts |
| `blockchain_*` | Direct RPC queries (balance, blocks, contract calls) |
| `workspace_*` | Dev server, stack status, logs |
| `backend_health` | Quick backend health check |

## Chain Rules

- **eSpace**: Ethereum-style `0x` addresses, chain ID 2030 (local)
- **Core Space**: CIP-37 base32 (`cfx:...`) addresses, chain ID 2029 (local)
