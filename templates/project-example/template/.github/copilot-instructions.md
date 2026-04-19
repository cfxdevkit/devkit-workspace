# Conflux DevKit — Project Example

This workspace runs the Conflux DevKit stack inside a devcontainer.
The `devkit` MCP server is registered in `.vscode/mcp.json` and exposes all devkit operations.

## MCP-First Operating Model

**Always prefer MCP tools over shell commands or direct API calls.**
The devkit backend is always-on inside the container (port 7748). Use the MCP tools as the primary control plane.

## Cold Start Checklist (follow in order)

1. `conflux_status` — read `Next step` and follow it exactly
2. `conflux_keystore_unlock` — only if status reports keystore locked
3. `conflux_node_start` — only if node is stopped
4. `conflux_accounts` — verify funded genesis accounts

## Workflow Sequences

### Stack bring-up / diagnosis
```
conflux_status  →  local_stack_status  →  backend_health (if still unclear)
```

### Deploy a bootstrap contract
```
conflux_bootstrap_entry  →  conflux_bootstrap_prepare  →  conflux_bootstrap_deploy
conflux_contracts  (confirm)
```

### Deploy to both chains
```
conflux_bootstrap_deploy_multi  (supply chainArgs when address formats differ)
```

### DEX workflows
```
dex_status  →  dex_deploy  →  dex_seed_from_gecko
```

## Chain Rules

- **eSpace**: Ethereum-style `0x` addresses, chain IDs 2030 (local) / 71 (testnet) / 1030 (mainnet)
- **Core Space**: CIP-37 base32 addresses (e.g. `cfx:aa...`), chain IDs 2029 (local) / 1 (testnet) / 1029 (mainnet)
- Constructor address args differ between chains — check before deploying to both.

## Key MCP Tool Groups

| Prefix | Purpose |
|--------|---------|
| `conflux_*` | Node lifecycle, keystore, network, contracts, bootstrap |
| `dex_*` | DEX deploy, seed, and status |
| `blockchain_*` | Direct RPC queries (balance, blocks, contract calls) |
| `workspace_*` | Dev server, stack status, logs |
| `agent_*` | Workspace context, operation history, runbooks |
| `backend_health` | Quick backend health check |

## Fallback — Public Networks / Docs

For testnet/mainnet deployment, contract verification, or documentation lookups,
see `.github/instructions/conflux-ecosystem.instructions.md`.
Do NOT apply this for local development — use the MCP tools instead.
