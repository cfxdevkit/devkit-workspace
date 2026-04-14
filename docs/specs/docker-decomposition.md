# Docker Decomposition Spec

## Purpose

Replace the single monolithic workspace image with a shared build pipeline and target-specific runtimes.

## Design

### Shared build responsibilities

These happen once in a shared artifact pipeline:

- build devkit backend distribution
- build MCP server distribution
- build VS Code extension artifact
- build shared service scripts and common config assets
- optionally build app assets that belong to standalone apps, not templates

These outputs are published or copied as build artifacts and consumed by target runtimes.

### Target responsibilities

#### `targets/devcontainer`

Default editor target for:

- local VS Code
- Codespaces

Responsibilities:

- install shared base runtime artifacts
- provide devcontainer-specific entrypoint and config
- avoid code-server-specific proxy behavior by default
- expose only target-relevant environment switches

#### `targets/code-server`

Optional browser IDE target.

Responsibilities:

- extend the shared base runtime
- add code-server only
- enable proxy/base URL features explicitly
- own browser IDE entrypoint behavior

## Build boundary rules

1. The shared base must not bake scaffold app source into runtime images.
2. The shared base must not assume a default workspace.
3. The code-server target must not define behavior required by the devcontainer target.
4. Codespaces-specific behavior should prefer config over a dedicated image unless proven necessary.
5. App templates and standalone apps are not part of the shared runtime image contract.

## Proposed file ownership

### `packages/devkit-base`

Owns:

- shared runtime metadata
- common env flags
- service startup scripts
- extension install metadata
- artifact manifest

### `targets/devcontainer`

Owns:

- target Dockerfile
- target entrypoint
- `.devcontainer` config templates

### `targets/code-server`

Owns:

- target Dockerfile
- browser IDE entrypoint
- code-server config templates
- proxy/base URL enablement defaults

## Initial artifact manifest

The shared build should produce a manifest shaped like:

```json
{
  "backend": { "type": "tgz", "path": "artifacts/devkit-backend.tgz" },
  "mcp": { "type": "tgz", "path": "artifacts/devkit-mcp.tgz" },
  "extension": { "type": "vsix", "path": "artifacts/devkit.vsix" },
  "config": { "type": "dir", "path": "artifacts/config" }
}
```

## Migration sequence

1. extract shared build stages from the old Dockerfile into a shared artifact pipeline
2. build `targets/devcontainer` from those artifacts only
3. build `targets/code-server` on top of the same base plus code-server additions
4. move any remaining baked-in app or template logic out of runtime targets
