# New DevKit Workspace

This repository is the clean migration target for the CFX DevKit refactor.

It exists to replace the current monolithic workspace/runtime/template coupling with a modular architecture built around:

- one shared devkit base for editor and service tooling
- target-specific runtime layers instead of one universal image
- scaffolding-only CLI behavior
- self-contained generated projects
- canonical reusable packages with explicit copy/materialization steps

Primary objective: maintainability first.

## Agreed Direction

- Remove runtime orchestration from the main CLI.
- Keep code-server support as a separate target, not the default product shape.
- Use one shared devcontainer base image for local VS Code and Codespaces unless divergence becomes necessary.
- Keep `project-example` as a reference app.
- Add a lighter minimal scaffold alongside the reference app.
- Keep DEX as a standalone stack on top of the backend/node, not as scaffolded dapp logic.
- Keep `ui-shared` as the canonical reusable package.
- Copy `ui-shared` source from the canonical package into generated projects.
- Generated projects must be self-contained after creation.
- Include target files directly in generated projects.
- Keep proxy/base URL support as a shared capability that targets can enable.
- Compatibility with the current CLI is not required.

## Initial CLI Scope

- `create`
- `list-templates`
- `list-targets`

Runtime orchestration is intentionally out of scope.

## Current Implementation Status

Implemented in this migration repo now:

- target and template manifest discovery
- a manifest-driven scaffold CLI
- `create`, `list-templates`, and `list-targets`
- shared infrastructure packages for backend and VS Code extension
- canonical `ui-shared` copy during generation
- generated project metadata in `.new-devkit/manifest.json`
- generated target metadata in a template-defined `generated/devkit-target.js` path
- rendered token substitution for project and target values
- a realistic minimal static dapp scaffold with a small built-in dev server
- a migrated `project-example` reference scaffold with monorepo layout, contracts package, dapp package, and root utility scripts
- shared-base and target Dockerfile flows for devcontainer and code-server, with backend and extension baked into reusable images

Quick commands:

- `pnpm run status:refactor`
- `pnpm run list:templates`
- `pnpm run list:templates:json`
- `pnpm run list:targets`
- `pnpm run list:targets:json`
- `pnpm run create:minimal:default`
- `pnpm run create:minimal:devcontainer`
- `pnpm run create:minimal:code-server`
- `pnpm run create:project-example:default`
- `pnpm run create:project-example:devcontainer`
- `pnpm run create:project-example:code-server`
- `pnpm run verify:templates`
- `pnpm run verify:devcontainer:local`

Local image tags used by generated targets:

- `new-devkit-base:dev`
- `new-devkit-devcontainer:dev`
- `new-devkit-code-server:dev`
- `ghcr.io/cfxdevkit/new-devkit-base:dev`
- `ghcr.io/cfxdevkit/new-devkit-devcontainer:dev`
- `ghcr.io/cfxdevkit/new-devkit-code-server:dev`

Generated devcontainers now default to local shared image tags through build args. This avoids Dev Containers registry metadata probes when you are working locally.
The shared image build still tags canonical GHCR-style names as publishing aliases, but generated local devcontainers default to `new-devkit-devcontainer:dev` and `new-devkit-code-server:dev`.
`docker pull new-devkit-devcontainer:dev` is still the wrong test. Use `pnpm run image:check:devcontainer` or `docker image inspect new-devkit-devcontainer:dev` to verify local availability.
Until shared images are actually published, generated `devcontainer.json` files also set `"pull": "never"` to keep the extension off registry fallback paths.

Devcontainer workflow:

1. `pnpm run image:build:devcontainer`
2. `pnpm run image:check:devcontainer`
3. `pnpm run create:project-example:devcontainer`
4. open `.generated/project-example-devcontainer` in Dev Containers

If the Dev Containers log shows `docker pull new-devkit-devcontainer:dev`, the scaffold was generated from an older target config. Regenerate it so `.devcontainer/devcontainer.json` uses `build.dockerfile` instead of `image` mode.

`pnpm run verify:devcontainer:local` runs the installed Dev Containers CLI directly against the generated `project-example-devcontainer` scaffold and verifies the same attach path outside the VS Code GUI.

If you later publish the shared images, you can override the generated build arg to a remote tag instead of changing the Dockerfile structure.

## Initial Output

The first milestone in this repo is architectural decomposition, not full feature parity.

See:

- `docs/adr/0001-modular-product-split.md`
- `docs/plans/migration-outline.md`
- `docs/plans/refactor-status.md`
