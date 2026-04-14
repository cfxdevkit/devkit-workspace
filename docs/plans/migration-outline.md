# Migration Outline

## Goals

- optimize for maintainability first
- remove hidden coupling between runtime, scaffold, and example app assembly
- split target runtimes without over-engineering early divergence
- make the CLI scaffold-only
- preserve reusable shared packages without forcing generated projects to depend on the monorepo

## Proposed top-level modules

- `packages/devkit-base`
  Shared runtime assets, service scripts, extension distribution metadata, common config.

- `packages/scaffold-cli`
  Scaffold-only CLI.

- `packages/template-core`
  Shared template materialization utilities and copy rules.

- `packages/ui-shared`
  Canonical reusable UI package.

- `templates/minimal-dapp`
  Minimal starter scaffold.

- `templates/project-example`
  Reference application scaffold.

- `targets/devcontainer`
  Shared devcontainer target assets and image/runtime definition.

- `targets/code-server`
  Optional browser IDE target built from the shared base.

- `apps/dex-ui`
  Standalone DEX stack, not part of scaffold generation.

## Confirmed design constraints

- shared base URL and proxy support stays in shared code as a capability that targets can enable
- `ui-shared` is copied from the canonical package into generated output
- generated projects include their own target files
- initial CLI commands are `create`, `list-templates`, and `list-targets`
- the old repository remains untouched during migration

## Migration phases

### Phase 1

- define module boundaries
- define build artifact boundaries
- split current Docker responsibilities into shared vs target-specific concerns

### Phase 2

- implement scaffold-only CLI
- implement template materialization contract
- add minimal scaffold and project-example scaffold
- implement verified copy-from-canonical flow for `ui-shared`

### Phase 3

- build devcontainer target from shared base
- build code-server target as optional specialized target
- move proxy/base URL behavior behind target-aware configuration

### Phase 4

- add verification matrix
- add release flow per target
- migrate docs from old repo assumptions to target-specific docs

Current recovery and progress tracking lives in `docs/plans/refactor-status.md`.

## Risks to manage

- reintroducing coupling through convenience scripts
- allowing template generation to depend on sibling source trees after creation
- carrying code-server proxy assumptions into the devcontainer target
- keeping DEX assets tied to project-example

## First implementation candidates

1. Define repository directory layout.
2. Split Docker build responsibilities into shared artifacts and target runtimes.
3. Specify the template materialization contract for `ui-shared`.
4. Design the scaffold-only CLI command surface.
5. Define target feature flags, including base URL and proxy support.
