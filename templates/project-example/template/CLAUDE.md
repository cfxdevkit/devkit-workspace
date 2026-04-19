# Conflux DevKit — Project Example

This workspace runs the Conflux DevKit stack inside a devcontainer.
The devkit backend and MCP server are always-on services — use the MCP tools, not shell commands, as the primary control plane.

## MCP Server

The `devkit` MCP server (`devkit-mcp`) exposes all devkit operations.
Always prefer MCP tools over direct API calls or shell commands.

## Operating Model

- Prefer MCP and backend workflows over shell-first approaches.
- The backend is always reachable on `localhost` from inside the container (port 7748).
- Treat `docker compose` / process inspection as diagnostics only.
- Start every session by checking stack readiness before deploying.

## Required Workflow Order

### Local stack bring-up / diagnosis
1. `conflux_status` — read the `Next step` field and follow it
2. `conflux_keystore_unlock` — only if status reports keystore locked
3. `conflux_node_start` — only if node is stopped
4. `conflux_accounts` — verify funded genesis accounts

### Bootstrap deploys
1. `conflux_status`
2. `conflux_bootstrap_entry` → `conflux_bootstrap_prepare`
3. `conflux_bootstrap_deploy` (single chain) or `conflux_bootstrap_deploy_multi` (both chains)
4. `conflux_contracts` or `conflux_contract_get` to confirm deployment

### Built-in template deploys
1. `conflux_status`
2. `conflux_deploy_prepare` → `conflux_deploy`
3. `conflux_contracts` or `conflux_contract_get`

### DEX workflows
1. `conflux_status`
2. `dex_status`
3. `dex_deploy` (once)
4. `dex_seed_from_gecko`

## Chain-Specific Rules

- **eSpace**: Ethereum-style `0x` addresses, chain IDs 2030 (local) / 71 (testnet) / 1030 (mainnet)
- **Core Space**: CIP-37 base32 addresses (e.g. `cfx:aa...`), chain IDs 2029 (local) / 1 (testnet) / 1029 (mainnet)
- Do not assume the same raw constructor args are valid for both chains.
- When targeting both chains, use `conflux_bootstrap_deploy_multi` and supply `chainArgs` when address formats differ.

## Key MCP Tool Groups

| Prefix | Purpose |
|--------|---------|
| `conflux_*` | Node lifecycle, keystore, network, contracts, bootstrap |
| `dex_*` | DEX deploy, seed, and status |
| `blockchain_*` | Direct RPC queries (balance, blocks, contract calls) |
| `workspace_*` | Dev server, stack status, logs |
| `agent_*` | Workspace context, operation history, runbooks |
| `backend_health` | Quick backend health check |

## Verification Shortcuts

- Health: `backend_health`
- Full readiness: `local_stack_status`
- Workspace context: `agent_workspace_context`
- Recent operations: `agent_operations_recent`

## Skills

Load `.github/instructions/conflux-ecosystem.instructions.md` only for:
- Public-network or testnet/mainnet deployment
- Contract verification on ConfluxScan
- Official documentation lookups
- Public chain state queries (when local devkit tools don't cover the task)

Load `.github/instructions/devkit-deploy.instructions.md` for compile and deploy sequences.
Load `.github/instructions/devkit-diagnostics.instructions.md` when runtime context or stack state is ambiguous.
