# ADR 0001: Modular Product Split

## Status

Accepted

## Context

The current CFX DevKit repository combines several separate concerns into one product surface:

- code-server browser workspace runtime
- devcontainer runtime for local VS Code
- Codespaces runtime behavior
- scaffold/template generation
- example application assembly
- DEX stack packaging
- CLI-based container orchestration

That coupling increases maintenance cost, makes Docker builds harder to reason about, and blurs the boundary between authored source, generated template output, and runtime packaging.

## Decision

The new repository will split responsibilities into separate modules and deliverables.

### 1. Shared base layer

A shared base will provide:

- Node/toolchain prerequisites
- devkit backend runtime
- MCP server runtime
- VS Code extension artifact/install assets
- common configuration and service scripts

This base is shared across devcontainer and code-server targets.

### 2. Devcontainer target

The default editor target is a devcontainer-oriented image/profile for:

- local VS Code
- Codespaces

These should share the same base image by default. They can diverge later only if that is justified by real behavior differences.

### 3. Code-server target

The browser IDE target becomes an optional specialized runtime built on top of the same base.

It should:

- reuse the same base configuration, services, and extension assets
- remain optional and separately built
- keep proxy/base URL behavior in shared code as a toggleable capability that is enabled only where needed

### 4. CLI scope

The CLI becomes scaffold-only.

It should:

- create projects from templates
- list available templates
- list available targets
- materialize target-specific files
- support target profiles such as devcontainer, Codespaces, and code-server variants

It should not:

- orchestrate docker/podman containers
- manage runtime profiles
- pull images
- launch or stop containers
- own runtime state management

### 5. Templates and examples

The new scaffold model should include:

- a minimal starter scaffold with only the base integration surface
- `project-example` as a richer reference application

The DEX app is not a scaffold. It is a standalone stack that sits on top of the backend/node.

### 6. Shared UI package

`ui-shared` remains canonical and reusable across multiple dapps.

Scaffolds materialize a copy at generation time from the canonical source package. The copy mechanism must be explicit, reliable, and easy to verify.

### 7. Generated project contract

Generated projects must be self-contained after creation. They must not rely on monorepo assembly scripts after generation.

Target-specific files such as devcontainer and code-server configuration are included in generated output rather than resolved from an external runtime package at creation time.

### 8. Migration policy

This refactor does not preserve compatibility with the existing CLI or repository layout. The migration proceeds in a new repository path for a clean break.

## Consequences

Positive:

- cleaner product boundaries
- smaller and easier-to-reason-about images
- simpler template lifecycle
- easier testing of each delivery target independently
- easier future addition of multiple scaffolds

Negative:

- no compatibility bridge for the current CLI flow
- migration work increases in the short term because responsibilities are being redistributed instead of wrapped
- release and documentation flow will need to be rebuilt around the new module split

## Immediate follow-up

- define target repository layout
- define artifact boundaries between shared base and target runtimes
- define scaffold packaging and copy/materialization rules
- define how base URL/proxy support is enabled per target
- define verification rules for canonical package copy materialization
- define verification matrix by target
