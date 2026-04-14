# Scaffold CLI Spec

## Scope

The CLI is scaffold-only.

It does not run containers, pull images, manage runtime state, or provide lifecycle commands.

## Initial commands

### `create`

Generate a project from a template and target selection.

Example shape:

```bash
new-devkit create ./my-app --template minimal-dapp
new-devkit create ./my-app --template project-example --target code-server
```

Responsibilities:

- resolve template
- resolve target profile, including template defaults
- materialize canonical packages such as `ui-shared`
- write target-specific files
- emit a fully self-contained project
- support machine-readable output for automation where useful

### `list-templates`

List available scaffold templates with manifest-driven metadata.

### `list-targets`

List supported target profiles with runtime and feature metadata.

## Deferred commands

Not for the initial phase:

- `upgrade`
- `doctor`
- `eject`

## Internal package roles

### `packages/scaffold-cli`

Owns command parsing and user-facing command output.

### `packages/template-core`

Owns template discovery, target discovery, file copy logic, and verification.

## Template-target model

A project is generated from:

- one template
- one or more target profiles

The first implementation may support one target at a time, but the internal model should not prevent multiple target outputs later.
