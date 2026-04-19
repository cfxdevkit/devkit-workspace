# Project Example Agent Rules

This workspace is the authoritative agent operating context inside the container.

## Operating Model

- Prefer MCP and backend workflows over shell-first workflows.
- Assume the backend is reachable on localhost from inside the container.
- Treat compose inspection as diagnostics, not the primary control plane.
- Start deploy and DEX flows by inspecting runtime context and stack readiness.

## Required Workflow Order

For local stack bring-up and diagnosis:

1. `conflux_status` — read `Next step` and follow it exactly
2. `conflux_keystore_unlock` — only if keystore is locked
3. `conflux_node_start` — only if node is stopped
4. `local_stack_status` — confirm full stack readiness
5. `agent_runbook_execute` with `local_stack_doctor` when diagnosis is still unclear

For bootstrap deploys:

1. `conflux_status`
2. `agent_workspace_context`
3. `conflux_bootstrap_entry`
4. `conflux_bootstrap_prepare`
5. `conflux_bootstrap_deploy` or `conflux_bootstrap_deploy_multi`
6. `conflux_contracts` or `conflux_contract_get` to confirm tracked deployment state

For built-in template deploys:

1. `conflux_status`
2. `local_stack_status`
3. `conflux_deploy_prepare`
4. `conflux_deploy`
5. `conflux_contracts` or `conflux_contract_get`

For DEX workflows:

1. `conflux_status`
2. `dex_status`
3. `dex_deploy`
4. `dex_seed_from_gecko`

## Chain-Specific Rule

- Do not assume the same raw constructor args are valid for both eSpace and Core.
- Address-typed args may need Core base32 format (`cfx:...`) on Core deployments.
- When targeting both chains, prefer `conflux_bootstrap_deploy_multi` and supply `chainArgs` when address formatting differs.

## Verification Shortcuts

- Health: `backend_health`
- Context: `agent_workspace_context`
- Recent operations: `agent_operations_recent`
- Full readiness: `local_stack_status`

## Skills / Instructions

For VS Code Copilot: see `.github/instructions/` for `devkit-diagnostics`, `devkit-deploy`, and `conflux-ecosystem`.
For Claude Code / opencode: use `devkit-diagnostics`, `devkit-deploy`, and `conflux-ecosystem` skills.
