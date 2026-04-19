# Scaffold CLI specification

## Purpose

The scaffold CLI is the distribution surface for generating self-contained Conflux DevKit projects.

It is published as `@cfxdevkit/scaffold-cli` and installs the executable name `scaffold-cli`.

## Scope

The CLI is scaffold-only.

It is responsible for:

- discovering templates from manifests
- discovering targets from manifests
- resolving template and target compatibility
- copying and rendering template files
- copying and rendering target-owned files
- materializing canonical packages into generated projects when required
- emitting generated metadata for downstream tooling and verification

It is not responsible for:

- container orchestration
- backend lifecycle management
- image pulling or publishing
- runtime state management
- post-generation project upgrades

## User-facing commands

### `new`

Primary project generation command.

```bash
scaffold-cli new ./my-app --template minimal-dapp
scaffold-cli new ./my-app --template project-example --target code-server
```

### `create`

Alias for `new`.

```bash
scaffold-cli create ./my-app --template minimal-dapp
```

### `list-templates`

Lists manifest-driven template metadata.

```bash
scaffold-cli list-templates
scaffold-cli list-templates --json
```

### `list-targets`

Lists manifest-driven target metadata.

```bash
scaffold-cli list-targets
scaffold-cli list-targets --json
```

## CLI contract

### Required generation inputs

Project generation requires:

- a destination path
- `--template <name>`

Optional inputs:

- `--target <name>`
- `--json`

If `--target` is omitted, the CLI must use the template default target.

### Output contract

On success, the CLI must:

- create the requested project in the destination directory
- print human-readable output by default
- print JSON when `--json` is provided

On failure, the CLI must:

- print a clear error message
- exit non-zero
- avoid partially succeeding silently

## Packaging contract

The published package must work outside the monorepo.

That means the npm package must include:

- CLI source under `src/`
- packaged scaffold assets under `assets/`
- templates
- targets
- canonical package sources required for materialization

The package must not depend on monorepo-relative imports at runtime.

For the current published flow, release verification also includes:

- `npm access get status @cfxdevkit/scaffold-cli` returns `public`
- `npm view @cfxdevkit/scaffold-cli version` resolves the published version
- `npx @cfxdevkit/scaffold-cli new ./my-app --template minimal-dapp` succeeds from outside the repo

## Internal ownership

### `packages/scaffold-cli/src/cli.js`

Owns:

- argument parsing
- usage text
- command dispatch
- human-readable and JSON command output

### `packages/scaffold-cli/src/template-core.js`

Owns:

- template discovery
- target discovery
- asset root resolution
- render-and-copy logic
- package materialization
- generation manifest output

### `packages/scaffold-cli/scripts/prepare-package.mjs`

Owns:

- building the package-local `assets/` directory before pack and publish

## Template-target model

A generated project is produced from:

- one template
- one target

The current public CLI resolves a single target per generation run. The internal manifest model should remain compatible with future expansion if multiple target outputs are ever needed.

## Generated metadata

Every generated project must include:

- `.devkit/manifest.json` for generation metadata
- a target metadata module at the template-declared generated path

This metadata is part of the verification surface and should be treated as a stable generated contract.

## Deferred features

The following are intentionally out of scope for the current CLI:

- `upgrade`
- `doctor`
- `eject`
- runtime management commands
