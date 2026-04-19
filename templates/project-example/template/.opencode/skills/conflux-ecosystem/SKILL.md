---
name: conflux-ecosystem
description: Fallback skill for public-network Conflux work, official documentation lookup, and non-local workflows when the local devkit MCP surface is not the right tool.
compatibility: opencode
---

## Priority rule

Prefer the local devkit MCP and backend tools for project-example work.

Use this skill only when the task is outside the normal local container workflow, such as:

- public testnet or mainnet deployment
- documentation lookup for Conflux-specific behavior
- public chain state inspection
- explorer or verification guidance

## Do not use this skill for

- local stack bring-up
- local bootstrap deploys
- local DEX deployment and seeding
- keystore and node lifecycle actions already covered by MCP tools
