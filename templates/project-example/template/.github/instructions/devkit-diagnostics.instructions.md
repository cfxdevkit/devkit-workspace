---
applyTo: "**"
---

# DevKit Diagnostics — Stack and Runtime Diagnosis

> Use this when the runtime context is ambiguous, stack readiness is unclear, or backend/MCP behavior seems inconsistent.

## Diagnosis order

1. `conflux_status` — read `Next step` field carefully
2. `agent_workspace_context` — confirm which workspace/runtime context the agent is in
3. `local_stack_status` — full stack readiness check
4. `agent_runbook_execute` with `local_stack_doctor` — when the issue is still unclear after step 3
5. `backend_health` — narrow backend-only health check
6. `agent_operations_recent` — inspect prior failed actions before retrying

## Rules

- Prefer backend-first diagnosis over compose-first diagnosis.
- Treat missing Docker/compose visibility as diagnostic context, not proof that the workspace backend is unusable.
- Do not move into deploy or DEX operations until readiness is explicit from `local_stack_status`.
- If a tool call returns an unexpected error, check `agent_operations_recent` for context before retrying.

## Node lifecycle recovery

| Situation | Tool |
|-----------|------|
| Keystore locked | `conflux_keystore_unlock` |
| Node stopped | `conflux_node_start` |
| Node in bad state | `conflux_node_restart` |
| Persistent state corruption | `conflux_node_wipe_restart` (destructive — confirm first) |

## When diagnosis is complete

- Confirm stack is ready with `local_stack_status` before proceeding to deploy or DEX operations.
- If accounts are needed, verify with `conflux_accounts`.
