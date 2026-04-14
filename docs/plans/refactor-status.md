# Refactor Status

This document is the recovery reference for the new-devkit migration.

If agent context is lost or the refactor session crashes, resume from this file first.

## Objective

Migrate the old `devkit-workspace` repository into the new modular structure at:

- `/home/simpa/Documents/Code/new-devkit-workspace`

Priorities:

1. maintainability first
2. scaffold-only CLI
3. shared base plus target-specific runtimes
4. self-contained generated projects

## Decisions Already Locked

- runtime orchestration is removed from the main CLI
- local VS Code and Codespaces share one devcontainer base unless a real divergence is proven
- code-server is a separate optional target built on the same base
- `project-example` remains a reference scaffold
- `minimal-dapp` remains a lighter starter scaffold
- DEX remains a standalone stack, not a scaffolded dapp
- `ui-shared` stays canonical and is copied into generated projects
- generated projects include their own target files
- base URL and proxy support remain shared capabilities enabled by target
- no compatibility bridge with the old CLI is required

## Completed Work

### Architecture

- modular split defined in `docs/adr/0001-modular-product-split.md`
- migration structure defined in `docs/plans/migration-outline.md`
- Docker split specified in `docs/specs/docker-decomposition.md`
- `ui-shared` materialization contract specified in `docs/specs/ui-shared-materialization.md`
- scaffold CLI scope specified in `docs/specs/scaffold-cli.md`

### Shared Base And Targets

- shared artifact preparation implemented in `scripts/prepare-devkit-artifacts.mjs`
- shared base Dockerfile implemented in `packages/devkit-base/Dockerfile`
- devcontainer target Dockerfile implemented in `targets/devcontainer/Dockerfile`
- code-server target Dockerfile exists in `targets/code-server/Dockerfile`, but is not fully hardened yet
- backend and VS Code extension are now shared infrastructure packages baked into the reusable target images

### CLI And Template Core

- manifest-driven scaffold CLI implemented in `packages/scaffold-cli/src/cli.js`
- template discovery, target discovery, default-target resolution, compatibility checks, rendering, and generation implemented in `packages/template-core/src/index.js`

### Templates

- `minimal-dapp` is a functional static starter scaffold
- `project-example` is now a real reference monorepo scaffold with:
  - `dapp/`
  - `contracts/`
  - copied `ui-shared/`
  - root scripts and workspace files
  - machine-readable operation logs under `.devkit/operations/`

## Verified Working

- `pnpm run list:templates`
- `pnpm run list:templates:json`
- `pnpm run list:targets`
- `pnpm run list:targets:json`
- `pnpm run create:minimal:default`
- `pnpm run create:minimal:devcontainer`
- `pnpm run create:minimal:code-server`
- `pnpm run create:project-example:default`
- generation metadata in `.new-devkit/manifest.json`
- generated target metadata in template-defined paths
- `project-example` contract compile and dapp build in generated output
- `project-example` structured root utility scripts with JSON output and operation ledger
- generated devcontainer target now references the shared reusable image and disables VS Code UID rewrite
- backend and extension packaging now come from builder stages instead of generated-project files
- base image build
- devcontainer target image build

## Known Gaps

- code-server target build exists but is not fully hardened or validated end-to-end
- no dedicated verification command existed before this status pass
- no release flow yet
- no template upgrade path yet
- no doctor command in the new CLI yet

## Current Repository Shape

- `packages/devkit-base`
- `packages/devkit-backend`
- `packages/scaffold-cli`
- `packages/template-core`
- `packages/ui-shared`
- `packages/vscode-extension`
- `targets/devcontainer`
- `targets/code-server`
- `templates/minimal-dapp`
- `templates/project-example`
- `apps/dex-ui`

## Recommended Resume Order

If work resumes after context loss, continue in this order:

1. run template verification
2. harden code-server target build
3. improve project-example fidelity against the old repo where useful
4. add release and verification matrix documentation

## Useful Commands

```bash
pnpm run list:templates
pnpm run list:targets
pnpm run create:minimal:default
pnpm run create:project-example:default
pnpm run verify:templates
```

## Notes For Future Agent Sessions

- work only in `/home/simpa/Documents/Code/new-devkit-workspace`
- do not modify the old repository unless explicitly requested
- preserve the scaffold-only CLI direction
- preserve self-contained generated output
- treat `ui-shared` as canonical source copied into generated projects
