# Conflux DevKit Workspace

This workspace runs the Conflux DevKit stack inside a devcontainer.
The devkit backend and MCP server are always-on services — use the MCP tools, not shell commands, as the primary control plane.

## MCP Server

The `devkit` MCP server (`devkit-mcp`) exposes all devkit operations.
Always prefer MCP tools over direct API calls or shell commands.

## Operating Model

- Prefer MCP and backend workflows over shell-first approaches.
- The backend is always reachable on `localhost` from inside the container (port 7748 by default).
- Treat `docker compose` / process inspection as diagnostics only.
- Start every session by checking stack readiness before deploying.

## Required Workflow Order

### Local stack bring-up / diagnosis
1. `conflux_status` — read `nextStep` and follow it exactly; if it says "Ready" do NOT call conflux_node_start
2. `local_stack_status` — confirm node + backend health
3. If still unclear: check `backend_health` and review logs

> **Standard dev mnemonic (used by conflux_setup_init):** `test test test test test test test test test test test junk`

### Bootstrap deploys
1. `conflux_status`
2. `conflux_bootstrap_deploy(name="ERC20Base")` — args auto-fill with deployer address
   - Or `conflux_bootstrap_deploy_multi` for both chains
3. Optional: `conflux_bootstrap_entry` → `conflux_bootstrap_prepare` for validation first

### Built-in template deploys
1. `conflux_status`
2. `conflux_deploy(name="SimpleStorage")` — constructor args auto-filled with sensible defaults
   - No prepare step needed; deploy directly with just the name

### DEX workflows
1. `conflux_status`
2. `dex_status`
3. `dex_deploy` (once)
4. `dex_seed_from_gecko`
5. `dex_manifest` → get contract addresses (factory, router02, WETH9)
6. `dex_translation_table` → token symbol/address map

## Chain-Specific Rules

- Do not assume the same raw constructor args are valid for both eSpace and Core.
- Address-typed constructor arguments may need Core base32 format on Core deployments.
- When targeting both chains, use `conflux_bootstrap_deploy_multi` and supply `chainArgs` when address formatting differs.

## Verification Shortcuts

- Health: `backend_health`
- Full readiness: `local_stack_status`
- Recent operations: `agent_operations_recent`

## Skills

Load `.github/instructions/conflux-ecosystem.instructions.md` only for:
- Public-network or testnet/mainnet deployment
- Contract verification on ConfluxScan
- Official documentation lookups
- Public chain state queries (when local devkit tools don't cover the task)
