# Conflux DevKit Workspace — Copilot Instructions

This workspace runs the Conflux DevKit stack (backend + MCP server) inside a devcontainer.
The `devkit` MCP server is registered in `.vscode/mcp.json` and exposes all devkit operations.

## MCP-First Operating Model

**Always prefer MCP tools over shell commands or direct API calls.**
The devkit backend is always-on inside the container (port 7748). Use the MCP tools as the primary control plane.

## Cold Start Checklist (follow in order)

1. `conflux_status` — **read `nextStep` and follow it exactly — do not skip ahead**
2. `conflux_setup_init` — only if status reports keystore not initialized (uses standard test mnemonic)
3. `conflux_keystore_unlock` — only if status reports keystore locked
4. `conflux_node_start` — only if status reports node stopped
5. `conflux_accounts` — verify 10 funded genesis accounts

> **If `conflux_status` nextStep says "Ready" — the stack is UP. Do NOT call `conflux_node_start`.**
> **Standard dev mnemonic: `test test test test test test test test test test test junk`**
> **Never ask the user to click "Start DevKit Server" — use MCP tools.**

## Workflow Sequences

### Stack bring-up / diagnosis
```
conflux_status  →  local_stack_status  →  backend_health (if still unclear)
```

### Deploy a built-in template contract (SimpleStorage, Counter, TestToken, etc.)
```
conflux_status  →  conflux_deploy(name="SimpleStorage")  →  done
```
Constructor args are auto-filled with sensible defaults. No prepare step needed.

### Deploy a bootstrap catalog contract (ERC20Base, MultiSigWallet, etc.)
```
conflux_status  →  conflux_bootstrap_deploy(name="ERC20Base")  →  done
```
Address args auto-fill with the deployer account. Use `conflux_bootstrap_catalog` to browse.
Optional: `conflux_bootstrap_entry` → `conflux_bootstrap_prepare` for validation before deploy.

### Deploy to both chains
```
conflux_bootstrap_deploy_multi  (supply chainArgs when address formats differ)
```

### DEX workflows
```
dex_status  →  dex_deploy  →  dex_seed_from_gecko  →  dex_manifest / dex_translation_table
```

## Chain Rules

- **eSpace**: Ethereum-style `0x` addresses, chain IDs 2030 (local) / 71 (testnet) / 1030 (mainnet)
- **Core Space**: CIP-37 base32 addresses (e.g. `cfx:aa...`), chain IDs 2029 (local) / 1 (testnet) / 1029 (mainnet)
- Constructor address args differ between chains — check before deploying to both.

## Key MCP Tool Groups

| Prefix | Purpose |
|--------|---------|
| `conflux_*` | Node lifecycle, keystore, network, contracts, bootstrap |
| `dex_*` | DEX deploy, seed, swap, pool management, simulation |
| `blockchain_*` | Direct RPC queries (balance, blocks, contract calls) |
| `workspace_*` | Dev server, stack status, logs |
| `backend_health` | Quick backend health check |

## Fallback — Public Networks / Docs

For testnet/mainnet deployment, contract verification, or documentation lookups,
use the knowledge in `.github/instructions/conflux-ecosystem.instructions.md`.
Do NOT use this for local development — use the MCP tools instead.
