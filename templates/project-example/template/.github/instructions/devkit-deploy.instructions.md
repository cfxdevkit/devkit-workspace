---
applyTo: "**"
---

# DevKit Deploy — Prepare-First Contract Deployment Workflows

> Use this when deploying bootstrap catalog contracts, built-in template contracts, or multi-chain deploys.

## Bootstrap deploy order

1. `conflux_status`
2. `agent_workspace_context`
3. `local_stack_status`
4. `conflux_bootstrap_entry` — look up catalog entry
5. `conflux_bootstrap_prepare` — validate constructor args
6. `conflux_bootstrap_deploy` (single chain) or `conflux_bootstrap_deploy_multi` (both chains)
7. `conflux_contracts` or `conflux_contract_get` — confirm tracked deployment state

## Built-in template deploy order

1. `conflux_status`
2. `local_stack_status`
3. `conflux_deploy_prepare` — validate name and constructor args
4. `conflux_deploy`
5. `conflux_contracts` or `conflux_contract_get`

## Multi-chain rule

- Do not assume identical constructor args work on both chains.
- If an address argument differs by chain format, use `chainArgs` with `conflux_bootstrap_deploy_multi`.
- eSpace takes `0x`-style addresses; Core Space takes CIP-37 base32 (`cfx:...`) addresses.
- If a Core deploy fails on an EVM-style address, retry with a Core-format address — do not claim Core is unsupported.

## Raw compile and deploy rule

- Prefer explicit validation steps (`conflux_bootstrap_prepare` / `conflux_deploy_prepare`) before executing deployment.
- Confirm ABI, constructor argument ordering, and account selection before mutating actions.

## After deployment

- Confirm deployment via `conflux_contracts` or `conflux_contract_get`.
- If the workflow partially fails, inspect the operation record with `agent_operations_recent` and retry only the failed chain or stage.
- Use `agent_operation_get` for a specific operation's full output.
