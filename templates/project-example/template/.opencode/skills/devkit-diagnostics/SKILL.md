---
name: devkit-diagnostics
description: Diagnose the local devkit workspace from project-example using workspace context, stack readiness, backend wrappers, and operation history.
compatibility: opencode
---

## Use this skill when

- the agent is unsure which workspace/runtime context it is in
- stack readiness is unclear
- backend and MCP behavior seem inconsistent after a refactor or restart

## Follow this order

1. Call `agent_workspace_context`.
2. Call `local_stack_status`.
3. If the issue is still unclear, call `agent_runbook_execute` with `local_stack_doctor`.
4. Use `backend_health`, `conflux_status`, or typed backend wrappers for narrower diagnosis.
5. Use `agent_operations_recent` to inspect prior failed actions before retrying.

## Rules

- Prefer backend-first diagnosis over compose-first diagnosis.
- Treat missing Docker/compose visibility as diagnostic context, not proof that the workspace backend is unusable.
- Do not move into deploy or DEX operations until readiness is explicit.
