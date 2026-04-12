# Artifact Policy

This policy classifies repository paths as tracked source or ephemeral generated output.

## Goals

- Keep generated/runtime artifacts out of source control.
- Make build and runtime behavior deterministic for automation and AI agents.
- Provide an enforceable check in CI and local workflows.

## Path Classes

### Tracked (source of truth)

- `packages/**/src/**`
- `packages/**/package.json`
- `packages/**/tsconfig*.json`
- `scripts/**`
- `scaffolds/**`
- `config/**`
- `README.md`, `LICENSE`, root `package.json`

### Ephemeral (must not be tracked)

- `node_modules/**`
- `.generated/**`
- `packages/*/dist/**`
- `packages/contracts/hh-artifacts/**`
- `packages/contracts/hh-cache/**`
- `packages/contracts/typechain-types/**`
- `dex-ui/dist/**`
- `project-example/**` (assembled output)

### Exception

- `scaffolds/project-example/**` is tracked template source.

## Enforcement

Run:

- `pnpm run policy:artifacts`
- `pnpm run policy:artifacts:strict`

Default mode fails on net-new violations while temporarily allowing legacy tracked contract build artifacts.
Strict mode fails on all violations, including legacy tracked generated paths.

## Notes

- Runtime caches used by MCP or DEX services should remain ephemeral.
- If a new generated directory is introduced, update this policy and `.gitignore` together.
- Migration note: existing tracked `packages/contracts/hh-artifacts/**`, `packages/contracts/hh-cache/**`, and `packages/contracts/typechain-types/**` are temporarily allowlisted in non-strict checks.
