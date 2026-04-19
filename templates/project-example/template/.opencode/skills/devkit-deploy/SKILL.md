---
name: devkit-deploy
description: Execute prepare-first Conflux contract deployment workflows from project-example, including bootstrap and multi-chain deploys.
compatibility: opencode
---

## Use this skill when

- deploying a bootstrap catalog contract
- deploying a built-in template contract
- validating constructor args before deployment
- deploying to both eSpace and Core
- confirming tracked deployment state after execution

## Bootstrap deploy order

1. `agent_workspace_context`
2. `local_stack_status`
3. `conflux_bootstrap_entry`
4. `conflux_bootstrap_prepare`
5. `conflux_bootstrap_deploy` or `conflux_bootstrap_deploy_multi`
6. `conflux_contracts` or `conflux_contract_get`

## Built-in template deploy order

1. `agent_workspace_context`
2. `local_stack_status`
3. `conflux_deploy_prepare`
4. `conflux_deploy`
5. `conflux_contracts` or `conflux_contract_get`

## Multi-chain rule

- Do not assume identical constructor args work on both chains.
- If an address argument differs by chain format, use `chainArgs` with `conflux_bootstrap_deploy_multi`.
- If Core deploy fails on an EVM-style address, retry with a Core-format address instead of claiming Core is unsupported.

## Raw compile and deploy rule

- Prefer explicit validation steps before raw deploy execution.
- Confirm ABI, constructor ordering, and account selection before mutating actions.

## After deployment

- Record the result by checking tracked deployment state.
- If the workflow partially fails, inspect the operation record and retry only the failed chain or stage.
